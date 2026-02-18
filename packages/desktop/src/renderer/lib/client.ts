import type { ClientEvent, DaemonEvent, PermissionResponse } from '@mainframe/types';

const WS_URL = 'ws://127.0.0.1:31415';

class DaemonClient {
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
    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      console.log('[daemon] connected');
      this.reconnectAttempts = 0;
      this.flushPendingMessages();
      this.notifyConnectionListeners();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as DaemonEvent;
        this.eventHandlers.forEach((handler) => handler(data));
      } catch (error) {
        console.error('[daemon] failed to parse event:', error);
      }
    };

    this.ws.onclose = () => {
      this.notifyConnectionListeners();
      if (this.intentionalClose) return;
      console.log('[daemon] disconnected');
      this.attemptReconnect();
    };

    this.ws.onerror = () => {
      this.notifyConnectionListeners();
    };
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[daemon] max reconnect attempts reached');
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
    }
  }

  private flushPendingMessages(): void {
    const queued = this.pendingMessages.splice(0);
    for (const event of queued) {
      this.send(event);
    }
  }

  // WebSocket commands
  createChat(projectId: string, adapterId: string, model?: string): void {
    this.send({ type: 'chat.create', projectId, adapterId, model });
  }

  updateChatConfig(
    chatId: string,
    adapterId?: string,
    model?: string,
    permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'yolo',
  ): void {
    this.send({ type: 'chat.updateConfig', chatId, adapterId, model, permissionMode });
  }

  resumeChat(chatId: string): void {
    this.send({ type: 'chat.resume', chatId });
  }

  endChat(chatId: string): void {
    this.send({ type: 'chat.end', chatId });
  }

  interruptChat(chatId: string): void {
    this.send({ type: 'chat.interrupt', chatId });
  }

  sendMessage(chatId: string, content: string, attachmentIds?: string[]): void {
    this.send({ type: 'message.send', chatId, content, attachmentIds });
  }

  respondToPermission(chatId: string, response: PermissionResponse): void {
    this.send({ type: 'permission.respond', chatId, response });
  }

  enableWorktree(chatId: string): void {
    this.send({ type: 'chat.enableWorktree', chatId });
  }

  disableWorktree(chatId: string): void {
    this.send({ type: 'chat.disableWorktree', chatId });
  }

  subscribe(chatId: string): void {
    this.send({ type: 'subscribe', chatId });
  }

  unsubscribe(chatId: string): void {
    this.send({ type: 'unsubscribe', chatId });
  }
}

export const daemonClient = new DaemonClient();
