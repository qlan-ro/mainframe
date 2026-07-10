/**
 * Atomic saves (sed -i, most editors, agent Edit tools) replace the file's
 * inode; fs.watch follows the OLD inode, fires one 'rename' and then goes
 * permanently silent (verified empirically on macOS). The service must
 * re-arm the watch on 'rename' so it tracks the path, not the inode.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';

const { fakeWatchers, watchBehavior } = vi.hoisted(() => {
  interface FakeWatcher {
    path: string;
    callback: (eventType: string) => void;
    close: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  }
  const fakeWatchers: FakeWatcher[] = [];
  const watchBehavior = { failNextCalls: 0 };
  return { fakeWatchers, watchBehavior };
});

vi.mock('node:fs', () => ({
  watch: vi.fn((path: string, _opts: unknown, cb: (eventType: string) => void) => {
    if (watchBehavior.failNextCalls > 0) {
      watchBehavior.failNextCalls--;
      throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    }
    const watcher = { path, callback: cb, close: vi.fn(), on: vi.fn() };
    fakeWatchers.push(watcher);
    return watcher;
  }),
}));

import { FileWatcherService } from '../files/file-watcher.js';
import { watch } from 'node:fs';

const PATH = '/tmp/project/file.ts';

describe('FileWatcherService — re-arm after rename (inode replacement)', () => {
  let broadcast: ReturnType<typeof vi.fn>;
  let service: FileWatcherService;

  beforeEach(() => {
    vi.useFakeTimers();
    broadcast = vi.fn();
    service = new FileWatcherService(broadcast as unknown as (event: DaemonEvent) => void);
    fakeWatchers.length = 0;
    watchBehavior.failNextCalls = 0;
    vi.mocked(watch).mockClear();
  });

  afterEach(() => {
    service.stopAll();
    vi.useRealTimers();
  });

  it('re-arms the watch on rename so later changes still broadcast', () => {
    service.subscribe(PATH);
    expect(fakeWatchers).toHaveLength(1);

    // Atomic replace: the kernel watch follows the old inode and dies.
    fakeWatchers[0]!.callback('rename');

    expect(fakeWatchers[0]!.close).toHaveBeenCalled();
    expect(fakeWatchers).toHaveLength(2);
    expect(fakeWatchers[1]!.path).toBe(PATH);

    // The rename itself still broadcasts after the debounce.
    vi.advanceTimersByTime(200);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith({ type: 'file:changed', path: PATH } satisfies DaemonEvent);

    // A later in-place change arrives via the NEW watcher and still broadcasts.
    fakeWatchers[1]!.callback('change');
    vi.advanceTimersByTime(200);
    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  it('retries once when the path is briefly absent mid-replace', () => {
    service.subscribe(PATH);

    watchBehavior.failNextCalls = 1; // the immediate re-watch hits the gap
    fakeWatchers[0]!.callback('rename');
    expect(fakeWatchers).toHaveLength(1); // immediate re-arm failed

    vi.advanceTimersByTime(100); // retry timer
    expect(fakeWatchers).toHaveLength(2);

    fakeWatchers[1]!.callback('change');
    vi.advanceTimersByTime(200);
    expect(broadcast).toHaveBeenCalled();
  });

  it('cleans up the entry when the path stays gone after the retry', () => {
    service.subscribe(PATH);

    watchBehavior.failNextCalls = 2; // both the immediate re-watch and the retry fail
    fakeWatchers[0]!.callback('rename');
    vi.advanceTimersByTime(100);

    expect(fakeWatchers).toHaveLength(1);
    // Entry is gone: the pending debounce was cancelled and nothing broadcasts.
    vi.advanceTimersByTime(500);
    expect(broadcast).not.toHaveBeenCalled();
    // A fresh subscribe starts over cleanly.
    service.subscribe(PATH);
    expect(fakeWatchers).toHaveLength(2);
  });

  it('a re-armed watch keeps the existing refcount (unsubscribe still tears down)', () => {
    service.subscribe(PATH);
    service.subscribe(PATH); // refCount 2

    fakeWatchers[0]!.callback('rename');
    expect(fakeWatchers).toHaveLength(2);

    service.unsubscribe(PATH);
    expect(fakeWatchers[1]!.close).not.toHaveBeenCalled();
    service.unsubscribe(PATH);
    expect(fakeWatchers[1]!.close).toHaveBeenCalled();
  });
});
