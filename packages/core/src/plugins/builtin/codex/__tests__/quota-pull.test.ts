import { describe, it, expect } from 'vitest';
import { pullCodexQuota } from '../quota-pull.js';

const NOW = Date.UTC(2026, 6, 18, 6, 0, 0);

describe('pullCodexQuota', () => {
  it('normalizes the injected rate-limit snapshot and stamps the resolved account identity', async () => {
    const quota = await pullCodexQuota({
      runRateLimits: async () => ({
        rateLimits: {
          limitId: 'codex',
          limitName: null,
          primary: { usedPercent: 41, windowDurationMins: 300, resetsAt: 1_784_800_000 },
          secondary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: 1_784_845_911 },
        },
      }),
      readAccount: async () => ({ type: 'chatgpt', email: 'a@b.com', planType: 'plus' }),
      now: NOW,
    });

    expect(quota?.status).toBe('ok');
    expect(quota?.session).toEqual({ kind: 'session', usedPercent: 41, resetsAt: 1_784_800_000_000 });
    expect(quota?.weekly).toEqual({ kind: 'weekly', usedPercent: 12, resetsAt: 1_784_845_911_000 });
    expect(quota?.accountIdentity).toBe('a@b.com');
    expect(quota?.observedAt).toBe(NOW);
  });

  it('stamps the transient identity sentinel when account/read fails, without failing the whole pull', async () => {
    const quota = await pullCodexQuota({
      runRateLimits: async () => ({
        rateLimits: { limitId: 'codex', limitName: null, primary: null, secondary: null },
      }),
      readAccount: async () => {
        throw new Error('app-server unreachable');
      },
      now: NOW,
    });

    expect(quota?.status).toBe('ok');
    expect(quota?.accountIdentity).toBe('transient:identity-read-failed');
  });
});
