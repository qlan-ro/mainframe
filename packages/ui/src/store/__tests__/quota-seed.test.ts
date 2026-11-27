import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderQuota } from '@qlan-ro/mainframe-types';
import { resetQuota, useQuotaStore } from '../quota';
import { QUOTA_SEED_TIMEOUT_MS, seedQuota } from '../quota-seed';

const getQuota = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/quota', () => ({ getQuota }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const quota = { observedAt: 1 } as unknown as ProviderQuota;

beforeEach(() => {
  getQuota.mockReset();
  resetQuota();
});

describe('seedQuota — seeded flag', () => {
  it('is not seeded while a provider has not answered', async () => {
    let answer: (q: ProviderQuota | null) => void = () => undefined;
    getQuota.mockImplementation((id: string) =>
      id === 'claude' ? new Promise((resolve) => (answer = resolve)) : Promise.resolve(null),
    );
    seedQuota(1);
    await flush();
    expect(useQuotaStore.getState().seeded).toBe(false);
    answer(quota);
    await flush();
    expect(useQuotaStore.getState().seeded).toBe(true);
  });

  it('is seeded when every provider answers with nothing known', async () => {
    getQuota.mockResolvedValue(null);
    seedQuota(1);
    await flush();
    expect(useQuotaStore.getState()).toMatchObject({ seeded: true, byId: {} });
  });

  it('is seeded when the requests fail: unknown is then the fact', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    getQuota.mockRejectedValue(new Error('down'));
    seedQuota(1);
    await flush();
    expect(useQuotaStore.getState().seeded).toBe(true);
  });

  it('a superseded seed does not mark the new one seeded', async () => {
    let answer: (q: ProviderQuota | null) => void = () => undefined;
    getQuota.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    getQuota.mockImplementationOnce(() => new Promise(() => undefined));
    seedQuota(1);
    getQuota.mockImplementation(() => new Promise(() => undefined));
    seedQuota(2);
    answer(null);
    await flush();
    expect(useQuotaStore.getState().seeded).toBe(false);
  });

  it('is seeded after a timeout when a request hangs, so the capsule never stays empty', async () => {
    vi.useFakeTimers();
    try {
      getQuota.mockImplementation(() => new Promise(() => undefined));
      seedQuota(1);
      await vi.advanceTimersByTimeAsync(QUOTA_SEED_TIMEOUT_MS - 1);
      expect(useQuotaStore.getState().seeded).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(useQuotaStore.getState().seeded).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
