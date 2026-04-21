import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { ChatManager } from '../chat/index.js';
import type { ClientEvent, DaemonEvent } from '@qlan-ro/mainframe-types';
import { ClientEventSchema } from './ws-schemas.js';
import { createChildLogger } from '../logger.js';
import { validateToken } from '../auth/token.js';
import { LspConnectionHandler, parseLspUpgradePath } from '../lsp/index.js';

const log = createChildLogger('ws');

const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isWsAuthRequired(ip: string, secret: string | null): boolean {
  if (!secret) return false;
  return !LOCALHOST_IPS.has(ip);
}

interface ClientConnection {
  ws: WebSocket;
  subscriptions: Set<string>;
}

export class WebSocketManager {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, ClientConnection>();

  constructor(
    server: Server,
    private chats: ChatManager,
    private lspHandler?: LspConnectionHandler,
  ) {
    this.wss = new WebSocketServer({ noServer: true });
    this.setupUpgradeAuth(server);
    this.setupEventHandlers();
  }

  private setupUpgradeAuth(server: Server): void {
    server.on('upgrade', (request, socket, head) => {
      const secret = process.env.AUTH_TOKEN_SECRET ?? null;
      const rawIp = request.socket.remoteAddress ?? '';
      // When behind a loopback proxy (cloudflared), read the real client IP
      const forwarded = request.headers['x-forwarded-for'];
      const ip =
        LOCALHOST_IPS.has(rawIp) && forwarded
          ? typeof forwarded === 'string'
            ? forwarded.split(',')[0]!.trim()
            : forwarded[0]!
          : rawIp;

      if (isWsAuthRequired(ip, secret)) {
        const url = new URL(request.url ?? '', 'http://localhost');
        const token = url.searchParams.get('token');

        if (!token || !validateToken(secret!, token)) {
          log.warn({ ip }, 'ws upgrade rejected: invalid or missing token');
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
      }

      const lspParsed = parseLspUpgradePath(request.url ?? '');
      if (lspParsed && this.lspHandler) {
        this.lspHandler.handleUpgrade(lspParsed.projectId, lspParsed.language, request, socket, head).catch((err) => {
          log.error({ err }, 'LSP upgrade error');
          socket.destroy();
        });
        return;
      }

      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });
  }

  private setupEventHandlers(): void {
    this.wss.on('connection', (ws) => {
      const client: ClientConnection = { ws, subscriptions: new Set() };
      this.clients.set(ws, client);

      ws.on('message', async (data) => {
        try {
          const raw = JSON.parse(data.toString());
          const parsed = ClientEventSchema.safeParse(raw);
          if (!parsed.success) {
            log.warn({ issues: parsed.error.issues }, 'ws message validation failed');
            this.sendError(ws, `Invalid message: ${parsed.error.issues.map((i) => i.message).join(', ')}`);
            return;
          }
          await this.handleClientEvent(client, parsed.data as ClientEvent);
        } catch (err) {
          log.error({ err }, 'ws message handler error');
          const message = err instanceof SyntaxError ? 'Invalid JSON' : 'Internal error';
          this.sendError(ws, message);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });
  }

  private async handleClientEvent(client: ClientConnection, event: ClientEvent): Promise<void> {
    switch (event.type) {
      case 'chat.create': {
        const chat = await this.chats.createChatWithDefaults(
          event.projectId,
          event.adapterId,
          event.model,
          event.permissionMode,
          event.worktreePath,
          event.branchName,
        );
        client.subscriptions.add(chat.id);
        break;
      }

      case 'chat.resume': {
        client.subscriptions.add(event.chatId);
        await this.chats.resumeChat(event.chatId);
        break;
      }

      case 'chat.updateConfig': {
        await this.chats.updateChatConfig(event.chatId, event.adapterId, event.model, event.permissionMode);
        break;
      }

      case 'chat.interrupt': {
        await this.chats.interruptChat(event.chatId);
        break;
      }

      case 'chat.end': {
        await this.chats.endChat(event.chatId);
        client.subscriptions.delete(event.chatId);
        break;
      }

      case 'message.send': {
        await this.chats.sendMessage(event.chatId, event.content, event.attachmentIds, event.metadata);
        break;
      }

      case 'permission.respond': {
        log.info(
          {
            chatId: event.chatId,
            requestId: event.response.requestId,
            toolName: event.response.toolName,
            behavior: event.response.behavior,
          },
          'permission.respond received from client',
        );
        await this.chats.respondToPermission(event.chatId, event.response);
        log.info(
          { chatId: event.chatId, requestId: event.response.requestId },
          'permission.respond delivered to adapter',
        );
        break;
      }

      case 'message.queue.edit': {
        await this.chats.editQueuedMessage(event.chatId, event.messageId, event.content);
        break;
      }

      case 'message.queue.cancel': {
        await this.chats.cancelQueuedMessage(event.chatId, event.messageId);
        break;
      }

      case 'subscribe': {
        client.subscriptions.add(event.chatId);
        // Rehydrate queued-message state for this client — the daemon is the
        // source of truth; the renderer's Zustand store may have drifted
        // during a WS disconnect.
        const refs = this.chats.getQueuedForChat(event.chatId);
        const snapshot: DaemonEvent = {
          type: 'message.queued.snapshot',
          chatId: event.chatId,
          refs,
        };
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify(snapshot));
        }
        break;
      }

      case 'unsubscribe': {
        client.subscriptions.delete(event.chatId);
        break;
      }
    }
  }

  broadcastEvent(event: DaemonEvent): void {
    const chatId = 'chatId' in event ? event.chatId : undefined;
    // Skip per-line output events — they flood the log with no value
    if (event.type !== 'launch.output') {
      const extra: Record<string, unknown> = { type: event.type };
      if (chatId) extra.chatId = chatId;
      if ('name' in event) extra.name = event.name;
      if ('status' in event) extra.status = event.status;
      if ('projectId' in event) extra.projectId = event.projectId;
      log.debug(extra, 'broadcast %s to %d client(s)', event.type, this.clients.size);
    }
    const payload = JSON.stringify(event);

    for (const client of this.clients.values()) {
      if (!chatId || client.subscriptions.has(chatId)) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(payload);
        }
      }
    }
  }

  close(): void {
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.close(1001, 'Server shutting down');
      }
    }
    this.clients.clear();
    this.wss.close();
  }

  private sendError(ws: WebSocket, message: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', error: message }));
    }
  }
}
