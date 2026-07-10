/**
 * Minimal daemon WebSocket client for app-tauri.
 *
 * Mirrors packages/app-electron/src/renderer/lib/client.ts but:
 * - Reads the port dynamically from the Tauri bridge (getDaemonPort)
 * - Skips Zustand / global stores entirely
 * - Exposes only what Phase 1 needs: connect, subscribe, send, onEvent, disconnect
 */
import type { ClientEvent, DaemonEvent } from '@qlan-ro/mainframe-types';
import { getActiveDaemon, subscribeActiveDaemon } from './active-daemon';

type EventHandler = (event: DaemonEvent) => void;
type ConnectionListener = () => void;
type FileChangeListener = () => void;

/**
 * The active-daemon singleton boots with the placeholder `http://127.0.0.1:0`
 * until the first successful /health poll seeds the real target. A target with
 * an explicit port 0 is that placeholder — connecting to it is always wrong
 * (ws://…:0 is a guaranteed CSP violation on every fresh load).
 */
function isSeededTarget(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).port !== '0';
  } catch {
    return false;
  }
}

export class DaemonWsClient {
  private ws: WebSocket | null = null;
  private port: number | null = null;
  private handlers = new Set<EventHandler>();
  private connectionListeners = new Set<ConnectionListener>();
  private pendingMessages: ClientEvent[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionalClose = false;
  /** Non-null while a connect() is deferred waiting for the target to be seeded. */
  private seedWaitUnsub: (() => void) | null = null;
  /** Maps requestedPath → resolvedPath, populated from subscribe:file:ack */
  private filePathMap = new Map<string, string>();
  /** Maps requestedPath → set of listeners */
  private fileListeners = new Map<string, Set<FileChangeListener>>();

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

    const t = getActiveDaemon();
    if (!isSeededTarget(t.baseUrl)) {
      this.connectWhenSeeded();
      return;
    }
    this.cancelSeedWait();
    const wsBase = t.baseUrl.replace(/^http/, 'ws');
    const url = t.token ? `${wsBase}?token=${encodeURIComponent(t.token)}` : wsBase;
    const socket = new WebSocket(url);
    this.ws = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.flushPending();
      this.notifyConnectionListeners();
    };

    socket.onmessage = (ev) => {
      if (socket !== this.ws) return; // stale socket after reconnect
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
      this.handleFileWatchEvent(data);
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
    this.cancelSeedWait();
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

  subscribeFile(path: string, context?: { projectId?: string; chatId?: string }): void {
    this.send({ type: 'subscribe:file', path, ...context });
  }

  unsubscribeFile(path: string, context?: { projectId?: string; chatId?: string }): void {
    this.filePathMap.delete(path);
    this.send({ type: 'unsubscribe:file', path, ...context });
  }

  /**
   * Register a listener for changes to `path`. Returns an unsubscribe fn.
   *
   * The daemon REALPATHs the subscribed path; `file:changed` carries the
   * resolved path. An ack (`subscribe:file:ack`) maps requestedPath →
   * resolvedPath so we can route the resolved path back to listeners keyed
   * by the original requested path.
   */
  onFileChange(path: string, listener: FileChangeListener): () => void {
    let listeners = this.fileListeners.get(path);
    if (!listeners) {
      listeners = new Set();
      this.fileListeners.set(path, listeners);
    }
    listeners.add(listener);
    return () => {
      const set = this.fileListeners.get(path);
      if (set) {
        set.delete(listener);
        if (set.size === 0) this.fileListeners.delete(path);
      }
    };
  }

  private handleFileWatchEvent(data: DaemonEvent): void {
    if (data.type === 'subscribe:file:ack') {
      this.filePathMap.set(data.requestedPath, data.resolvedPath);
      return;
    }
    if (data.type === 'file:changed') {
      const resolvedPath = data.path;
      // Find all requested paths that resolved to this path and invoke listeners.
      for (const [requestedPath, mapped] of this.filePathMap) {
        if (mapped === resolvedPath) {
          const listeners = this.fileListeners.get(requestedPath);
          if (listeners) {
            listeners.forEach((fn) => fn());
          }
        }
      }
    }
  }

  private flushPending(): void {
    const queued = this.pendingMessages.splice(0);
    for (const ev of queued) this.send(ev);
  }

  private notifyConnectionListeners(): void {
    this.connectionListeners.forEach((fn) => fn());
  }

  /** Defer the connect until setActiveDaemon() delivers a seeded target. */
  private connectWhenSeeded(): void {
    if (this.seedWaitUnsub) return;
    this.seedWaitUnsub = subscribeActiveDaemon(() => {
      this.cancelSeedWait();
      this.connect();
    });
  }

  private cancelSeedWait(): void {
    this.seedWaitUnsub?.();
    this.seedWaitUnsub = null;
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
