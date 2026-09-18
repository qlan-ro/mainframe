/**
 * HeartbeatWatchdog — behavior tests (todo #350 plan review fixes, T28, R2.6).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { HeartbeatWatchdog } from '../acp-heartbeat-watchdog';

afterEach(() => {
  vi.useRealTimers();
});

describe('HeartbeatWatchdog — silence', () => {
  it('fires repeatedly on sustained silence, not just once', () => {
    vi.useFakeTimers();
    const onGap = vi.fn();
    const watchdog = new HeartbeatWatchdog(1000, onGap);

    watchdog.arm();
    vi.advanceTimersByTime(6000);

    expect(onGap).toHaveBeenCalledTimes(3);
  });

  it('a heartbeat resets the silence window, so silence resumes counting from zero', () => {
    vi.useFakeTimers();
    const onGap = vi.fn();
    const watchdog = new HeartbeatWatchdog(1000, onGap);

    watchdog.arm();
    vi.advanceTimersByTime(1500);
    watchdog.observe(1);
    vi.advanceTimersByTime(1500);

    expect(onGap).not.toHaveBeenCalled();
  });

  it('stop() cancels the pending silence timer', () => {
    vi.useFakeTimers();
    const onGap = vi.fn();
    const watchdog = new HeartbeatWatchdog(1000, onGap);

    watchdog.arm();
    watchdog.stop();
    vi.advanceTimersByTime(10000);

    expect(onGap).not.toHaveBeenCalled();
  });
});

describe('HeartbeatWatchdog — sequence gap', () => {
  it('a sequence jump greater than one fires onGap immediately', () => {
    vi.useFakeTimers();
    const onGap = vi.fn();
    const watchdog = new HeartbeatWatchdog(1000, onGap);

    watchdog.observe(1);
    watchdog.observe(3);

    expect(onGap).toHaveBeenCalledTimes(1);
  });
});
