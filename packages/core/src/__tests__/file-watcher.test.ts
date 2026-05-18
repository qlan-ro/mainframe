import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';

const { mockWatcher, mockWatchImpl } = vi.hoisted(() => {
  const mockWatcher = {
    close: vi.fn(),
    on: vi.fn(),
  };
  let watchCallback: ((eventType: string) => void) | null = null;
  const mockWatchImpl = {
    get callback() {
      return watchCallback;
    },
    set callback(cb: ((eventType: string) => void) | null) {
      watchCallback = cb;
    },
  };
  return { mockWatcher, mockWatchImpl };
});

vi.mock('node:fs', () => ({
  watch: vi.fn((_path: string, _opts: unknown, cb: (eventType: string) => void) => {
    mockWatchImpl.callback = cb;
    return mockWatcher;
  }),
}));

import { FileWatcherService } from '../files/file-watcher.js';
import { watch } from 'node:fs';

describe('FileWatcherService', () => {
  let broadcast: ReturnType<typeof vi.fn>;
  let service: FileWatcherService;

  beforeEach(() => {
    vi.useFakeTimers();
    broadcast = vi.fn();
    service = new FileWatcherService(broadcast);
    vi.mocked(watch).mockClear();
    mockWatcher.close.mockClear();
    mockWatcher.on.mockClear();
    mockWatchImpl.callback = null;
  });

  afterEach(() => {
    service.stopAll();
    vi.useRealTimers();
  });

  it('starts a watcher when first client subscribes', () => {
    service.subscribe('/tmp/test.ts');
    expect(watch).toHaveBeenCalledWith('/tmp/test.ts', { persistent: false }, expect.any(Function));
  });

  it('does not start a second watcher for the same path', () => {
    service.subscribe('/tmp/test.ts');
    service.subscribe('/tmp/test.ts');
    expect(watch).toHaveBeenCalledTimes(1);
  });

  it('broadcasts file:changed after debounce', () => {
    service.subscribe('/tmp/test.ts');
    mockWatchImpl.callback?.('change');
    // Before debounce delay, no broadcast
    expect(broadcast).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(broadcast).toHaveBeenCalledWith({ type: 'file:changed', path: '/tmp/test.ts' } satisfies DaemonEvent);
  });

  it('debounces rapid changes into a single broadcast', () => {
    service.subscribe('/tmp/test.ts');
    mockWatchImpl.callback?.('change');
    vi.advanceTimersByTime(100);
    mockWatchImpl.callback?.('change');
    vi.advanceTimersByTime(200);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('closes watcher when last subscriber unsubscribes', () => {
    service.subscribe('/tmp/test.ts');
    service.unsubscribe('/tmp/test.ts');
    expect(mockWatcher.close).toHaveBeenCalled();
  });

  it('keeps watcher when there are remaining subscribers', () => {
    service.subscribe('/tmp/test.ts');
    service.subscribe('/tmp/test.ts');
    service.unsubscribe('/tmp/test.ts');
    expect(mockWatcher.close).not.toHaveBeenCalled();
    service.unsubscribe('/tmp/test.ts');
    expect(mockWatcher.close).toHaveBeenCalled();
  });

  it('stopAll closes all watchers', () => {
    service.subscribe('/tmp/a.ts');
    // Need separate mock instances for different paths, but our mock always returns the same object
    // Just verify stopAll calls cleanup for all tracked paths
    service.stopAll();
    expect(mockWatcher.close).toHaveBeenCalled();
  });

  it('unsubscribe for unknown path is a no-op', () => {
    expect(() => service.unsubscribe('/tmp/unknown.ts')).not.toThrow();
  });
});
