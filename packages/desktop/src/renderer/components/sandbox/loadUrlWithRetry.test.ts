import { describe, it, expect, vi } from 'vitest';
import { loadUrlWithRetry } from './loadUrlWithRetry';

const noSleep = () => Promise.resolve();

describe('loadUrlWithRetry', () => {
  it('returns true and calls load once when the first attempt succeeds', async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const ok = await loadUrlWithRetry({
      load,
      attempts: 5,
      delayMs: 10,
      isCancelled: () => false,
      onError,
      sleep: noSleep,
    });
    expect(ok).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('retries after failures and succeeds, reporting each failure', async () => {
    let n = 0;
    const load = vi.fn().mockImplementation(() => (++n < 3 ? Promise.reject(new Error('refused')) : Promise.resolve()));
    const onError = vi.fn();
    const ok = await loadUrlWithRetry({
      load,
      attempts: 5,
      delayMs: 10,
      isCancelled: () => false,
      onError,
      sleep: noSleep,
    });
    expect(ok).toBe(true);
    expect(load).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenLastCalledWith(expect.any(Error), 2);
  });

  it('gives up after the attempt budget and returns false', async () => {
    const load = vi.fn().mockRejectedValue(new Error('refused'));
    const onError = vi.fn();
    const ok = await loadUrlWithRetry({
      load,
      attempts: 3,
      delayMs: 10,
      isCancelled: () => false,
      onError,
      sleep: noSleep,
    });
    expect(ok).toBe(false);
    expect(load).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(3);
  });

  it('stops immediately when cancelled before an attempt', async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const ok = await loadUrlWithRetry({
      load,
      attempts: 5,
      delayMs: 10,
      isCancelled: () => true,
      onError: vi.fn(),
      sleep: noSleep,
    });
    expect(ok).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('does not retry after a failure if cancelled meanwhile', async () => {
    let cancelled = false;
    const load = vi.fn().mockImplementation(() => {
      cancelled = true;
      return Promise.reject(new Error('refused'));
    });
    const onError = vi.fn();
    const ok = await loadUrlWithRetry({
      load,
      attempts: 5,
      delayMs: 10,
      isCancelled: () => cancelled,
      onError,
      sleep: noSleep,
    });
    expect(ok).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
