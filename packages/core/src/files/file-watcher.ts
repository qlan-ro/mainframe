import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { createChildLogger } from '../logger.js';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';

const log = createChildLogger('file-watcher');

const DEBOUNCE_MS = 200;
/** Grace delay before the second re-watch attempt when the path is briefly absent mid-replace. */
const REARM_RETRY_MS = 100;

type BroadcastFn = (event: DaemonEvent) => void;

interface WatchEntry {
  watcher: FSWatcher;
  refCount: number;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Manages per-file fs.watch instances on behalf of WS clients.
 * Multiple clients may watch the same path; reference counting ensures
 * the watcher is only created once and torn down when the last subscriber leaves.
 */
export class FileWatcherService {
  private watchers = new Map<string, WatchEntry>();
  private broadcast: BroadcastFn;

  constructor(broadcast: BroadcastFn) {
    this.broadcast = broadcast;
  }

  subscribe(absolutePath: string): void {
    const existing = this.watchers.get(absolutePath);
    if (existing) {
      existing.refCount++;
      log.debug({ path: absolutePath, refCount: existing.refCount }, 'file watch ref++');
      return;
    }

    const watcher = this.openWatcher(absolutePath);
    if (!watcher) return;

    const entry: WatchEntry = { watcher, refCount: 1, debounceTimer: null };
    this.watchers.set(absolutePath, entry);
    log.debug({ path: absolutePath }, 'file watch started');
  }

  private openWatcher(absolutePath: string): FSWatcher | null {
    let watcher: FSWatcher;
    try {
      watcher = watch(absolutePath, { persistent: false }, (eventType) => {
        // Atomic saves (rename-over: sed -i, most editors, agent Edit tools)
        // replace the inode; the kernel watch follows the OLD inode and goes
        // permanently silent. Re-arm so the watch tracks the path.
        if (eventType === 'rename') this.rearm(absolutePath);
        this.scheduleEmit(absolutePath);
      });
    } catch (err) {
      log.warn({ err, path: absolutePath }, 'failed to start file watcher');
      return null;
    }

    watcher.on('error', (err) => {
      log.warn({ err, path: absolutePath }, 'file watcher error');
      this.cleanup(absolutePath);
    });
    return watcher;
  }

  private rearm(absolutePath: string): void {
    const entry = this.watchers.get(absolutePath);
    if (!entry) return;
    try {
      entry.watcher.close();
    } catch (err) {
      log.warn({ err, path: absolutePath }, 'error closing file watcher during re-arm');
    }
    const next = this.openWatcher(absolutePath);
    if (next) {
      entry.watcher = next;
      return;
    }
    // The path can be briefly absent mid-replace — retry once before giving up.
    setTimeout(() => {
      if (this.watchers.get(absolutePath) !== entry) return;
      const retry = this.openWatcher(absolutePath);
      if (retry) {
        entry.watcher = retry;
        return;
      }
      log.warn({ path: absolutePath }, 'file watch lost after rename (path gone) — cleaning up');
      this.cleanup(absolutePath);
    }, REARM_RETRY_MS);
  }

  unsubscribe(absolutePath: string): void {
    const entry = this.watchers.get(absolutePath);
    if (!entry) return;
    entry.refCount--;
    log.debug({ path: absolutePath, refCount: entry.refCount }, 'file watch ref--');
    if (entry.refCount <= 0) {
      this.cleanup(absolutePath);
    }
  }

  stopAll(): void {
    for (const path of this.watchers.keys()) {
      this.cleanup(path);
    }
  }

  private scheduleEmit(absolutePath: string): void {
    const entry = this.watchers.get(absolutePath);
    if (!entry) return;
    if (entry.debounceTimer !== null) {
      clearTimeout(entry.debounceTimer);
    }
    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = null;
      log.debug({ path: absolutePath }, 'file changed, broadcasting');
      this.broadcast({ type: 'file:changed', path: absolutePath });
    }, DEBOUNCE_MS);
  }

  private cleanup(absolutePath: string): void {
    const entry = this.watchers.get(absolutePath);
    if (!entry) return;
    if (entry.debounceTimer !== null) {
      clearTimeout(entry.debounceTimer);
    }
    try {
      entry.watcher.close();
    } catch (err) {
      log.warn({ err, path: absolutePath }, 'error closing file watcher');
    }
    this.watchers.delete(absolutePath);
    log.debug({ path: absolutePath }, 'file watch stopped');
  }
}
