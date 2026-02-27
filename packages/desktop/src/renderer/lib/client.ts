import type { ClientEvent, DaemonEvent, ControlResponse } from '@mainframe/types';
import { createLogger } from './logger';

const WS_URL = 'ws://127.0.0.1:31415';
const log = createLogger('renderer:ws');

export class DaemonClient {
  private ws: WebSocket | null = null;
  private eventHandlers = new Set<(event: DaemonEvent) => void>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = Infinity;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private pendingMessages: ClientEvent[] = [];
  private connectionListeners = new Set<() => void>();

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private notifyConnectionListeners(): void {
    this.connectionListeners.forEach((fn) => fn());
  }

  subscribeConnection = (callback: () => void): (() => void) => {
    this.connectionListeners.add(callback);
    return () => {
      this.connectionListeners.delete(callback);
    };
  };

  getConnectionSnapshot = (): boolean => {
    return this.ws?.readyState === WebSocket.OPEN;
  };

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;

    this.intentionalClose = false;
    const socket = new WebSocket(WS_URL);
    this.ws = socket;

    socket.onopen = () => {
      log.info('connected');
      this.reconnectAttempts = 0;
      this.flushPendingMessages();
      this.notifyConnectionListeners();
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as DaemonEvent;
        this.eventHandlers.forEach((handler) => handler(data));
      } catch (error) {
        log.error('failed to parse event', { err: String(error) });
      }
    };

    socket.onclose = () => {
      if (socket !== this.ws) return;
      this.notifyConnectionListeners();
      if (this.intentionalClose) return;
      log.info('disconnected');
      this.attemptReconnect();
    };

    socket.onerror = () => {
      if (socket !== this.ws) return;
      this.notifyConnectionListeners();
    };
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log.error('max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(500 * 2 ** (this.reconnectAttempts - 1), 5000);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.notifyConnectionListeners();
  }

  onEvent(handler: (event: DaemonEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  private send(event: ClientEvent): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    } else if (this.ws?.readyState === WebSocket.CONNECTING) {
      this.pendingMessages.push(event);
    } else {
      const state = this.ws ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][this.ws.readyState] : 'NO_SOCKET';
      log.warn('WS not ready, dropping message', { state, type: event.type });
    }
  }

  private flushPendingMessages(): void {
    const queued = this.pendingMessages.splice(0);
    for (const event of queued) {
      this.send(event);
    }
  }

  // WebSocket commands
  createChat(
    projectId: string,
    adapterId: string,
    model?: string,
    permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'yolo',
  ): void {
    this.send({ type: 'chat.create', projectId, adapterId, model, permissionMode });
    log.info('createChat', { projectId, adapterId, model, permissionMode });
  }

  updateChatConfig(
    chatId: string,
    adapterId?: string,
    model?: string,
    permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'yolo',
  ): void {
    this.send({ type: 'chat.updateConfig', chatId, adapterId, model, permissionMode });
    log.info('updateChatConfig', { chatId, adapterId, model, permissionMode });
  }

  resumeChat(chatId: string): void {
    this.send({ type: 'chat.resume', chatId });
    log.debug('resumeChat', { chatId });
  }

  endChat(chatId: string): void {
    this.send({ type: 'chat.end', chatId });
    log.info('endChat', { chatId });
  }

  interruptChat(chatId: string): void {
    this.send({ type: 'chat.interrupt', chatId });
    log.info('interruptChat', { chatId });
  }

  sendMessage(
    chatId: string,
    content: string,
    attachmentIds?: string[],
    metadata?: { command?: { name: string; source: string; args?: string } },
  ): void {
    this.send({ type: 'message.send', chatId, content, attachmentIds, metadata });
    log.info('sendMessage', { chatId, attachmentCount: attachmentIds?.length ?? 0 });
  }

  respondToPermission(chatId: string, response: ControlResponse): void {
    this.send({ type: 'permission.respond', chatId, response });
    log.info('respondToPermission', {
      chatId,
      requestId: response.requestId,
      toolName: response.toolName,
      behavior: response.behavior,
    });
  }

  enableWorktree(chatId: string): void {
    this.send({ type: 'chat.enableWorktree', chatId });
    log.info('enableWorktree', { chatId });
  }

  disableWorktree(chatId: string): void {
    this.send({ type: 'chat.disableWorktree', chatId });
    log.info('disableWorktree', { chatId });
  }

  subscribe(chatId: string): void {
    this.send({ type: 'subscribe', chatId });
  }

  unsubscribe(chatId: string): void {
    this.send({ type: 'unsubscribe', chatId });
  }
}

export const daemonClient = new DaemonClient();

// Expose for E2E test introspection (harmless: renderer runs inside Electron, not on the public web)
(window as Window & { __daemonClient?: DaemonClient }).__daemonClient = daemonClient;
