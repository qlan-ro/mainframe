import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { createChildLogger } from '../logger.js';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';

const log = createChildLogger('file-watcher');

const DEBOUNCE_MS = 200;

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

    let watcher: FSWatcher;
    try {
      watcher = watch(absolutePath, { persistent: false }, (_eventType) => {
        this.scheduleEmit(absolutePath);
      });
    } catch (err) {
      log.warn({ err, path: absolutePath }, 'failed to start file watcher');
      return;
    }

    watcher.on('error', (err) => {
      log.warn({ err, path: absolutePath }, 'file watcher error');
      this.cleanup(absolutePath);
    });

    const entry: WatchEntry = { watcher, refCount: 1, debounceTimer: null };
    this.watchers.set(absolutePath, entry);
    log.debug({ path: absolutePath }, 'file watch started');
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
