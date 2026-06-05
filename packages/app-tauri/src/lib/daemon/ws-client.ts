/**
 * Minimal daemon WebSocket client for app-tauri.
 *
 * Mirrors packages/desktop/src/renderer/lib/client.ts but:
 * - Reads the port dynamically from the Tauri bridge (getDaemonPort)
 * - Skips Zustand / global stores entirely
 * - Exposes only what Phase 1 needs: connect, subscribe, send, onEvent, disconnect
 */
import type { ClientEvent, DaemonEvent } from '@qlan-ro/mainframe-types';

type EventHandler = (event: DaemonEvent) => void;
type ConnectionListener = () => void;

export class DaemonWsClient {
  private ws: WebSocket | null = null;
  private port: number | null = null;
  private handlers = new Set<EventHandler>();
  private connectionListeners = new Set<ConnectionListener>();
  private pendingMessages: ClientEvent[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionalClose = false;

  /** Call once before connect() — the port comes from getDaemonPort() in the Tauri bridge. */
  setPort(port: number): void {
    this.port = port;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    if (this.port == null) {
      console.warn('[ws-client] connect() called before setPort()');
      return;
    }
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;
    this.intentionalClose = false;

    const socket = new WebSocket(`ws://127.0.0.1:${this.port}`);
    this.ws = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.flushPending();
      this.notifyConnectionListeners();
    };

    socket.onmessage = (ev) => {
      let data: DaemonEvent;
      try {
        data = JSON.parse(ev.data as string) as DaemonEvent;
      } catch (err) {
        console.warn('[ws-client] failed to parse event', err);
        return;
      }
      this.handlers.forEach((h) => h(data));
    };

    socket.onclose = () => {
      if (socket !== this.ws) return;
      this.notifyConnectionListeners();
      if (!this.intentionalClose) this.scheduleReconnect();
    };

    socket.onerror = () => {
      if (socket !== this.ws) return;
      this.notifyConnectionListeners();
    };
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

  onEvent(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  subscribeConnection(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  send(event: ClientEvent): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    } else if (this.ws?.readyState === WebSocket.CONNECTING) {
      this.pendingMessages.push(event);
    } else {
      console.warn('[ws-client] dropping message — socket not ready', event.type);
    }
  }

  subscribe(chatId: string): void {
    this.send({ type: 'subscribe', chatId });
  }

  unsubscribe(chatId: string): void {
    this.send({ type: 'unsubscribe', chatId });
  }

  private flushPending(): void {
    const queued = this.pendingMessages.splice(0);
    for (const ev of queued) this.send(ev);
  }

  private notifyConnectionListeners(): void {
    this.connectionListeners.forEach((fn) => fn());
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(500 * 2 ** (this.reconnectAttempts - 1), 5000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

/** Singleton — one WS connection for the entire app-tauri renderer. */
export const daemonWs = new DaemonWsClient();
