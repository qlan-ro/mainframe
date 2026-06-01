import type { ClientEvent, DaemonEvent, ControlResponse, ExecutionMode } from '@qlan-ro/mainframe-types';
import { createLogger } from './logger';
import {
  interruptChatRest,
  resumeChatRest,
  editQueuedMessageRest,
  cancelQueuedMessageRest,
  updateChatConfig as updateChatConfigRest,
} from './api/chats-api';

const env = (import.meta as { env?: Record<string, string> }).env ?? {};
const host: string = env['VITE_DAEMON_HOST'] ?? '127.0.0.1';
const wsPort: string = env['VITE_DAEMON_WS_PORT'] ?? '31415';
const WS_URL = `ws://${host}:${wsPort}`;
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
  private clientId: string | null = null;
  readonly visitedChats = new Set<string>();
  private subscribeAckWaiters = new Map<string, Array<() => void>>();

  /** Stable id assigned by the daemon when this WS connection was accepted. */
  getClientId(): string | null {
    return this.clientId;
  }

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
      this.resubscribeVisitedChats();
      this.notifyConnectionListeners();
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as DaemonEvent;
        if (data.type === 'connection.ready') {
          this.clientId = data.clientId;
          return;
        }
        if (data.type === 'subscribe:ack') {
          this.resolveSubscribeAck(data.chatId);
        }
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

  private resubscribeVisitedChats(): void {
    for (const chatId of this.visitedChats) {
      this.send({ type: 'subscribe', chatId });
    }
  }

  private resolveSubscribeAck(chatId: string): void {
    const arr = this.subscribeAckWaiters.get(chatId);
    if (arr) {
      this.subscribeAckWaiters.delete(chatId);
      arr.forEach((r) => r());
    }
  }

  private waitForSubscribeAck(chatId: string, timeoutMs = 5000): Promise<void> {
    return new Promise((resolve) => {
      const arr = this.subscribeAckWaiters.get(chatId) ?? [];
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        // Remove this waiter so a timed-out resolver never leaks in the map.
        const cur = this.subscribeAckWaiters.get(chatId);
        if (cur) {
          const i = cur.indexOf(settle);
          if (i >= 0) cur.splice(i, 1);
          if (cur.length === 0) this.subscribeAckWaiters.delete(chatId);
        }
        resolve();
      };
      arr.push(settle);
      this.subscribeAckWaiters.set(chatId, arr);
      // Fail-open: never hang resume. A missed ack only happens on a broken
      // socket, where the reconnect handler re-subscribes visitedChats and the
      // renderer re-fetches messages via REST — so no state is permanently lost.
      setTimeout(settle, timeoutMs);
    });
  }

  updateChatConfig(
    chatId: string,
    adapterId?: string,
    model?: string,
    permissionMode?: ExecutionMode,
    planMode?: boolean,
  ): void {
    void updateChatConfigRest(chatId, { adapterId, model, permissionMode, planMode }).catch((e) =>
      log.warn('updateChatConfig failed', { chatId, err: String(e) }),
    );
  }

  resumeChat(chatId: string): void {
    this.visitedChats.add(chatId);
    void (async () => {
      try {
        this.subscribe(chatId);
        await this.waitForSubscribeAck(chatId);
        await resumeChatRest(chatId);
      } catch (e) {
        log.warn('resumeChat failed', { chatId, err: String(e) });
      }
    })();
  }

  interruptChat(chatId: string): void {
    void interruptChatRest(chatId).catch((e) => log.warn('interruptChat failed', { chatId, err: String(e) }));
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

  editQueuedMessage(chatId: string, messageId: string, content: string): void {
    void editQueuedMessageRest(chatId, messageId, content).catch((e) =>
      log.warn('editQueuedMessage failed', { chatId, messageId, err: String(e) }),
    );
  }

  cancelQueuedMessage(chatId: string, messageId: string): void {
    void cancelQueuedMessageRest(chatId, messageId).catch((e) =>
      log.warn('cancelQueuedMessage failed', { chatId, messageId, err: String(e) }),
    );
  }

  subscribe(chatId: string): void {
    this.send({ type: 'subscribe', chatId });
  }

  unsubscribe(chatId: string): void {
    this.visitedChats.delete(chatId);
    this.send({ type: 'unsubscribe', chatId });
  }

  subscribeFile(path: string): void {
    this.send({ type: 'subscribe:file', path });
  }

  unsubscribeFile(path: string): void {
    this.send({ type: 'unsubscribe:file', path });
  }
}

export const daemonClient = new DaemonClient();

// Expose for E2E test introspection (harmless: renderer runs inside Electron, not on the public web)
if (typeof window !== 'undefined') {
  (window as Window & { __daemonClient?: DaemonClient }).__daemonClient = daemonClient;
}
