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
      let parsed: unknown;
      try {
        parsed = JSON.parse(ev.data as string);
      } catch (err) {
        console.warn('[ws-client] failed to parse event', err);
        return;
      }
      // Boundary guard: only dispatch well-formed events (object + string `type`)
      // to the reducers. We deliberately do NOT re-declare the daemon's full
      // `DaemonEvent` union here (single canonical type lives in mainframe-types;
      // the discriminated handler's default case covers unknown types) — this
      // just stops a malformed/non-object frame from reaching `h(data)`.
      if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { type?: unknown }).type !== 'string') {
        console.warn('[ws-client] dropping malformed daemon event', parsed);
        return;
      }
      const data = parsed as DaemonEvent;
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
      return;
    }
    // Never silently drop: a lost message.send / permission.respond looks like
    // success while the daemon never received it. Buffer and let the
    // (re)connection flush it (`flushPending` runs on `onopen`). A CONNECTING
    // socket flushes on its own; an absent/CLOSED one needs a reconnect kick.
    this.pendingMessages.push(event);
    if (
      !this.intentionalClose &&
      this.port != null &&
      this.reconnectTimer == null &&
      this.ws?.readyState !== WebSocket.CONNECTING
    ) {
      this.connect();
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
