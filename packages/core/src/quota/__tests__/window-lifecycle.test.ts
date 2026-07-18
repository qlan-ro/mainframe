import { describe, it, expect } from 'vitest';
import type { ProviderQuota, QuotaWindow } from '@qlan-ro/mainframe-types';
import {
  effectiveResetAt,
  isWindowTrusted,
  isProviderStale,
  collectQuotaWindows,
} from '../window-lifecycle.js';
import { SESSION_WINDOW_DURATION_MS, WEEKLY_WINDOW_DURATION_MS, STALE_THRESHOLD_MS } from '../constants.js';

const NOW = 1_720_000_000_000;

describe('effectiveResetAt', () => {
  it('uses resetsAt when present, ignoring observedAt', () => {
    const window: QuotaWindow = { kind: 'session', usedPercent: 10, resetsAt: 5_000 };
    expect(effectiveResetAt(window, 1_000)).toBe(5_000);
  });

  it('synthesizes a session ceiling of observedAt + 5h when resetsAt is null', () => {
    const window: QuotaWindow = { kind: 'session', usedPercent: 10, resetsAt: null };
    expect(effectiveResetAt(window, 1_000)).toBe(1_000 + SESSION_WINDOW_DURATION_MS);
  });

  it('synthesizes a weekly ceiling of observedAt + 7d when resetsAt is null', () => {
    const window: QuotaWindow = { kind: 'weekly', usedPercent: 10, resetsAt: null };
    expect(effectiveResetAt(window, 1_000)).toBe(1_000 + WEEKLY_WINDOW_DURATION_MS);
  });

  it('synthesizes a weekly-model ceiling of observedAt + 7d when resetsAt is null', () => {
    const window: QuotaWindow = { kind: 'weekly-model', usedPercent: 10, resetsAt: null };
    expect(effectiveResetAt(window, 1_000)).toBe(1_000 + WEEKLY_WINDOW_DURATION_MS);
  });
});

describe('isWindowTrusted', () => {
  it('is trusted while now is before the effective reset', () => {
    const window: QuotaWindow = { kind: 'session', usedPercent: 10, resetsAt: NOW + 1 };
    expect(isWindowTrusted(window, NOW, NOW)).toBe(true);
  });

  it('is untrusted once now reaches the effective reset', () => {
    const window: QuotaWindow = { kind: 'session', usedPercent: 10, resetsAt: NOW };
    expect(isWindowTrusted(window, NOW, NOW)).toBe(false);
  });

  it('is untrusted once now passes the effective reset', () => {
    const window: QuotaWindow = { kind: 'session', usedPercent: 10, resetsAt: NOW - 1 };
    expect(isWindowTrusted(window, NOW, NOW)).toBe(false);
  });
});

describe('isProviderStale', () => {
  it('is not stale before the threshold', () => {
    const quota: ProviderQuota = { status: 'ok', modelWindows: [], observedAt: NOW - (STALE_THRESHOLD_MS - 1) };
    expect(isProviderStale(quota, NOW)).toBe(false);
  });

  it('is stale at exactly the threshold', () => {
    const quota: ProviderQuota = { status: 'ok', modelWindows: [], observedAt: NOW - STALE_THRESHOLD_MS };
    expect(isProviderStale(quota, NOW)).toBe(true);
  });

  it('is stale past the threshold', () => {
    const quota: ProviderQuota = { status: 'ok', modelWindows: [], observedAt: NOW - STALE_THRESHOLD_MS - 1 };
    expect(isProviderStale(quota, NOW)).toBe(true);
  });
});

describe('collectQuotaWindows', () => {
  it('collects session, weekly and model windows in order', () => {
    const session: QuotaWindow = { kind: 'session', usedPercent: 1, resetsAt: null };
    const weekly: QuotaWindow = { kind: 'weekly', usedPercent: 2, resetsAt: null };
    const model: QuotaWindow = { kind: 'weekly-model', usedPercent: 3, resetsAt: null, label: 'opus' };
    const quota: ProviderQuota = { status: 'ok', session, weekly, modelWindows: [model], observedAt: NOW };
    expect(collectQuotaWindows(quota)).toEqual([session, weekly, model]);
  });

  it('omits absent session/weekly windows', () => {
    const quota: ProviderQuota = { status: 'unknown', modelWindows: [], observedAt: NOW };
    expect(collectQuotaWindows(quota)).toEqual([]);
  });
});
