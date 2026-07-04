import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { ChatManager } from '../chat/index.js';
import type { ClientEvent, DaemonEvent } from '@qlan-ro/mainframe-types';
import { ClientEventSchema } from './ws-schemas.js';
import { createChildLogger } from '../logger.js';
import { validateAuthedToken } from '../auth/validate-authed-token.js';
import type { DevicesRepository } from '../db/devices.js';
import { LspConnectionHandler, parseLspUpgradePath } from '../lsp/index.js';
import type { FileWatcherService } from '../files/file-watcher.js';
import { WsFileWatch, resolveSubscribePath } from './ws-file-watch.js';
import type { AdapterRegistry } from '../adapters/index.js';
import { buildConnectReplayEvents } from './adapter-replay.js';

const log = createChildLogger('ws');

const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isWsAuthRequired(ip: string, secret: string | null): boolean {
  if (!secret) return false;
  return !LOCALHOST_IPS.has(ip);
}

interface ClientConnection {
  ws: WebSocket;
  /** Stable per-connection id; sent to the client and stamped on origin-sensitive broadcasts. */
  id: string;
  subscriptions: Set<string>;
  fileWatch: WsFileWatch;
}

export class WebSocketManager {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, ClientConnection>();

  constructor(
    server: Server,
    private chats: ChatManager,
    private lspHandler?: LspConnectionHandler,
    private fileWatcher?: FileWatcherService,
    private devicesRepo?: DevicesRepository,
    private adapters?: AdapterRegistry,
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

        if (!token || !this.devicesRepo || !validateAuthedToken(secret!, token, this.devicesRepo)) {
          log.warn({ ip }, 'ws upgrade rejected: invalid or missing token');
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
      }

      const lspParsed = parseLspUpgradePath(request.url ?? '');
      if (lspParsed && this.lspHandler) {
        this.lspHandler
          .handleUpgrade(lspParsed.projectId, lspParsed.language, lspParsed.chatId, request, socket, head)
          .catch((err) => {
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
      const client: ClientConnection = {
        ws,
        id: randomUUID(),
        subscriptions: new Set(),
        fileWatch: new WsFileWatch(),
      };
      this.clients.set(ws, client);

      const ready: DaemonEvent = { type: 'connection.ready', clientId: client.id };
      ws.send(JSON.stringify(ready));

      if (this.adapters) {
        for (const event of buildConnectReplayEvents(this.adapters.getSnapshots())) {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
        }
      }

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
        if (this.fileWatcher) {
          client.fileWatch.unsubscribeAll(this.fileWatcher);
        }
        this.clients.delete(ws);
      });
    });
  }

  private async handleClientEvent(client: ClientConnection, event: ClientEvent): Promise<void> {
    switch (event.type) {
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

      case 'subscribe:file': {
        if (this.fileWatcher) {
          const absolutePath = resolveSubscribePath(this.chats, event.path, event.projectId, event.chatId);
          if (absolutePath) {
            await client.fileWatch.subscribe(
              event.path,
              absolutePath,
              this.fileWatcher,
              client.ws,
              event.projectId,
              event.chatId,
            );
          }
        }
        break;
      }

      case 'unsubscribe:file': {
        if (this.fileWatcher) {
          client.fileWatch.unsubscribe(event.path, this.fileWatcher, event.projectId, event.chatId);
        }
        break;
      }

      case 'subscribe': {
        client.subscriptions.add(event.chatId);
        this.sendQueuedSnapshot(client, event.chatId);
        // Ack so clients (e.g. REST resume) can confirm the subscription is
        // registered server-side before issuing a follow-up command. Without
        // this, events emitted during resume could be missed (WS and HTTP are
        // separate transports with no cross-transport ordering guarantee).
        const ack: DaemonEvent = { type: 'subscribe:ack', chatId: event.chatId };
        client.ws.send(JSON.stringify(ack));
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

  /** Send the daemon's current queued-message refs for a chat to a single
   *  client. Used by both `subscribe` and `chat.resume` so the composer
   *  banner reconverges on the daemon's truth whenever the client (re)opens
   *  the chat — prevents stale entries from surviving a chat-switch. */
  private sendQueuedSnapshot(client: ClientConnection, chatId: string): void {
    const refs = this.chats.getQueuedForChat(chatId);
    const snapshot: DaemonEvent = { type: 'message.queued.snapshot', chatId, refs };
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(snapshot));
    }
  }
}
