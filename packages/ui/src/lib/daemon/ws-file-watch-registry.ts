/**
 * Client-side file-watch bookkeeping for DaemonWsClient.
 *
 * File watches are per-connection state on the daemon (WsFileWatch is wiped
 * when the socket closes), so the client keeps its own registry of live
 * watches and replays `subscribe:file` for each of them on every socket open.
 *
 * The daemon REALPATHs the subscribed path; `file:changed` carries the
 * resolved path. An ack (`subscribe:file:ack`) maps requestedPath →
 * resolvedPath so the resolved path routes back to listeners keyed by the
 * original requested path.
 */
import type { ClientEvent, DaemonEvent } from '@qlan-ro/mainframe-types';

export interface FileWatchContext {
  projectId?: string;
  chatId?: string;
}

type FileChangeListener = () => void;

interface FileSubscription {
  path: string;
  context?: FileWatchContext;
  /** Live holders (components) of this watch — the wire sub dies at 0. */
  count: number;
}

/** Mirrors the daemon's WsFileWatch composite key (projectId|chatId|path). */
function fileSubKey(path: string, context?: FileWatchContext): string {
  return `${context?.projectId ?? ''}|${context?.chatId ?? ''}|${path}`;
}

export class FileWatchRegistry {
  /** Maps requestedPath → resolvedPath, populated from subscribe:file:ack */
  private filePathMap = new Map<string, string>();
  /** Maps requestedPath → set of listeners */
  private fileListeners = new Map<string, Set<FileChangeListener>>();
  /** Live watches, keyed by fileSubKey — replayed on every socket open. */
  private subscriptions = new Map<string, FileSubscription>();

  /** Returns the frame to send, or null when another holder already owns the watch. */
  subscribe(path: string, context?: FileWatchContext): ClientEvent | null {
    const key = fileSubKey(path, context);
    const existing = this.subscriptions.get(key);
    if (existing) {
      existing.count++;
      return null;
    }
    this.subscriptions.set(key, { path, context, count: 1 });
    return { type: 'subscribe:file', path, ...context };
  }

  /** Returns the frame to send, or null while other holders remain. */
  unsubscribe(path: string, context?: FileWatchContext): ClientEvent | null {
    const key = fileSubKey(path, context);
    const sub = this.subscriptions.get(key);
    if (sub && --sub.count > 0) return null;
    this.subscriptions.delete(key);
    const pathStillWatched = [...this.subscriptions.values()].some((s) => s.path === path);
    if (!pathStillWatched) this.filePathMap.delete(path);
    return { type: 'unsubscribe:file', path, ...context };
  }

  /** Register a listener for changes to `path`. Returns an unsubscribe fn. */
  addListener(path: string, listener: FileChangeListener): () => void {
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

  /** One subscribe:file frame per live watch — sent on every socket open. */
  replayFrames(): ClientEvent[] {
    return [...this.subscriptions.values()].map(({ path, context }) => ({
      type: 'subscribe:file',
      path,
      ...context,
    }));
  }

  handleEvent(data: DaemonEvent): void {
    if (data.type === 'subscribe:file:ack') {
      this.filePathMap.set(data.requestedPath, data.resolvedPath);
      return;
    }
    if (data.type === 'file:changed') {
      const resolvedPath = data.path;
      // Find all requested paths that resolved to this path and invoke listeners.
      for (const [requestedPath, mapped] of this.filePathMap) {
        if (mapped === resolvedPath) {
          this.fileListeners.get(requestedPath)?.forEach((fn) => fn());
        }
      }
    }
  }
}
