import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { ChatManager } from '../chat/index.js';
import type { ClientEvent, DaemonEvent } from '@mainframe/types';
import { ClientEventSchema } from './ws-schemas.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('ws');

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
  ) {
    this.wss = new WebSocketServer({ server });
    this.setupEventHandlers();
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
        );
        client.subscriptions.add(chat.id);
        await this.chats.startChat(chat.id);
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

      case 'chat.enableWorktree': {
        await this.chats.enableWorktree(event.chatId);
        break;
      }

      case 'chat.disableWorktree': {
        await this.chats.disableWorktree(event.chatId);
        break;
      }

      case 'subscribe': {
        client.subscriptions.add(event.chatId);
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
    log.debug({ type: event.type, chatId }, 'broadcasting event');
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
