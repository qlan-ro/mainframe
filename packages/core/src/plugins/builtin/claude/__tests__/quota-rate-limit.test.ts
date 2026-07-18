import { describe, it, expect, vi } from 'vitest';
import type { SessionSink } from '@qlan-ro/mainframe-types';
import { normalizeRateLimitEvent } from '../quota-rate-limit.js';
import { handleStdout } from '../events.js';

const NOW = 1_700_000_000_000;

describe('normalizeRateLimitEvent', () => {
  it('maps a five_hour warning to a session window (fraction→percent, sec→ms)', () => {
    const quota = normalizeRateLimitEvent(
      { status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 0.93, resetsAt: 1_789_999_999 },
      NOW,
    );
    expect(quota).toEqual({
      status: 'ok',
      observedAt: NOW,
      modelWindows: [],
      session: { kind: 'session', usedPercent: 93, resetsAt: 1_789_999_999_000 },
    });
  });

  it('maps seven_day to a weekly window', () => {
    const quota = normalizeRateLimitEvent({ rateLimitType: 'seven_day', utilization: 0.5, resetsAt: 1_789_999_999 }, NOW);
    expect(quota?.weekly).toEqual({ kind: 'weekly', usedPercent: 50, resetsAt: 1_789_999_999_000 });
    expect(quota?.session).toBeUndefined();
  });

  it('maps seven_day_opus to a labeled weekly-model window', () => {
    const quota = normalizeRateLimitEvent({ rateLimitType: 'seven_day_opus', utilization: 0.8 }, NOW);
    expect(quota?.modelWindows).toEqual([{ kind: 'weekly-model', usedPercent: 80, resetsAt: null, label: 'opus' }]);
  });

  it('returns null for a healthy event carrying no utilization (cannot drive a gauge)', () => {
    expect(normalizeRateLimitEvent({ status: 'allowed', rateLimitType: 'five_hour' }, NOW)).toBeNull();
  });

  it('returns null for the overage window (not surfaced)', () => {
    expect(normalizeRateLimitEvent({ rateLimitType: 'overage', utilization: 0.9 }, NOW)).toBeNull();
  });

  it('returns null when rate_limit_info is missing', () => {
    expect(normalizeRateLimitEvent(undefined, NOW)).toBeNull();
  });
});

describe('handleStdout — rate_limit_event wiring', () => {
  it('emits a normalized ProviderQuota for claude via onProviderQuota', () => {
    const onProviderQuota = vi.fn();
    const sink = { onProviderQuota } as unknown as SessionSink;
    const session = { id: 's1', state: { buffer: '', lastActivityAt: 0 } } as never;

    const line = JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { rateLimitType: 'five_hour', utilization: 0.42, resetsAt: 1_789_999_999 },
    });
    handleStdout(session, Buffer.from(`${line}\n`), sink);

    expect(onProviderQuota).toHaveBeenCalledTimes(1);
    const [adapterId, quota] = onProviderQuota.mock.calls[0];
    expect(adapterId).toBe('claude');
    expect(quota.session).toEqual({ kind: 'session', usedPercent: 42, resetsAt: 1_789_999_999_000 });
  });
});
