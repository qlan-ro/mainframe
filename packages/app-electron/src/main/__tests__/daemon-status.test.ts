import { describe, it, expect, vi } from 'vitest';

vi.mock('../logger.js', () => ({
  createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { DaemonStatusTracker } from '../daemon-status.js';

describe('DaemonStatusTracker', () => {
  it('starts at initializing', () => {
    const t = new DaemonStatusTracker(31415);
    expect(t.get()).toBe('initializing');
    expect(t.port()).toBe(31415);
  });

  it('set() updates status and notifies subscribers', () => {
    const t = new DaemonStatusTracker(31415);
    const cb = vi.fn();
    t.subscribe(cb);
    t.set('ready');
    expect(t.get()).toBe('ready');
    expect(cb).toHaveBeenCalledWith('ready');
  });

  it('subscribe() immediately replays the current status', () => {
    const t = new DaemonStatusTracker(31415);
    t.set('starting');
    const cb = vi.fn();
    t.subscribe(cb);
    expect(cb).toHaveBeenCalledWith('starting');
  });

  it('unsubscribe stops further notifications', () => {
    const t = new DaemonStatusTracker(31415);
    const cb = vi.fn();
    const off = t.subscribe(cb);
    off();
    cb.mockClear();
    t.set('ready');
    expect(cb).not.toHaveBeenCalled();
  });

  it('rejects a status outside the contract vocabulary', () => {
    const t = new DaemonStatusTracker(31415);
    // @ts-expect-error — invalid status guarded at runtime
    expect(() => t.set('green')).toThrow();
  });
});
