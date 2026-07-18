import { describe, it, expect } from 'vitest';
import type { ProviderQuota, QuotaWindow } from '@qlan-ro/mainframe-types';
import { unknownProviderQuota, handlePullFailure } from '../backoff.js';

const NOW = 1_720_000_000_000;

describe('unknownProviderQuota', () => {
  it('builds an empty unknown blob stamped with the given clock', () => {
    expect(unknownProviderQuota(NOW)).toEqual({
      status: 'unknown',
      modelWindows: [],
      observedAt: NOW,
    });
  });
});

describe('handlePullFailure', () => {
  it('returns an unknown blob when there is no last-known state', () => {
    expect(handlePullFailure(undefined, NOW)).toEqual(unknownProviderQuota(NOW));
  });

  it('keeps the last-known windows and stays ok while they are still trusted', () => {
    const session: QuotaWindow = { kind: 'session', usedPercent: 40, resetsAt: NOW + 10_000 };
    const prior: ProviderQuota = { status: 'ok', session, modelWindows: [], observedAt: NOW - 5_000 };

    const result = handlePullFailure(prior, NOW);

    expect(result.status).toBe('ok');
    expect(result.session).toBe(session);
    expect(result.observedAt).toBe(NOW - 5_000);
  });

  it('fails closed to unknown once the last-known windows expire, without wiping the data', () => {
    const session: QuotaWindow = { kind: 'session', usedPercent: 40, resetsAt: NOW - 1 };
    const prior: ProviderQuota = { status: 'ok', session, modelWindows: [], observedAt: NOW - 5_000 };

    const result = handlePullFailure(prior, NOW);

    expect(result.status).toBe('unknown');
    expect(result.session).toBe(session);
  });
});
