import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeQuotaScheduler } from '../claude-scheduler.js';

describe('ClaudeQuotaScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs one warm-up pull on start regardless of connected clients', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const scheduler = new ClaudeQuotaScheduler({ refresh, hasClients: () => false, intervalMs: 1000 });

    scheduler.start();
    await vi.runOnlyPendingTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('pulls on a timer tick only when at least one client is connected', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    let connected = false;
    const scheduler = new ClaudeQuotaScheduler({ refresh, hasClients: () => connected, intervalMs: 1000 });

    scheduler.start();
    await vi.runOnlyPendingTimersAsync(); // warm-up pull (1)

    await vi.advanceTimersByTimeAsync(1000); // tick, no clients → skipped
    expect(refresh).toHaveBeenCalledTimes(1);

    connected = true;
    await vi.advanceTimersByTimeAsync(1000); // tick, client present → pulls
    expect(refresh).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('stop() halts further timer pulls', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const scheduler = new ClaudeQuotaScheduler({ refresh, hasClients: () => true, intervalMs: 1000 });

    scheduler.start(); // warm-up pull (1)
    await Promise.resolve();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('swallows a pull rejection and keeps ticking', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('spawn failed'));
    const scheduler = new ClaudeQuotaScheduler({ refresh, hasClients: () => true, intervalMs: 1000 });

    scheduler.start(); // warm-up (1), rejects
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000); // tick (2), rejects
    await vi.advanceTimersByTimeAsync(1000); // tick (3) still fires despite prior rejections
    expect(refresh).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });
});
