import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ProviderQuota } from '@qlan-ro/mainframe-types';
import {
  QUOTA_AMBER_THRESHOLD,
  QUOTA_RED_THRESHOLD,
  deriveQuotaRow,
  deriveWindowList,
  formatAbsoluteReset,
  formatRelativeReset,
  formatUsedPercent,
  minutesAgo,
  severityOf,
  windowLabel,
} from '../quota-format';

const NOW = 1_752_750_000_000; // fixed injected clock
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('severityOf', () => {
  it('maps percentages to the three tunable severities', () => {
    expect(severityOf(0)).toBe('normal');
    expect(severityOf(74)).toBe('normal');
    expect(severityOf(QUOTA_AMBER_THRESHOLD)).toBe('amber'); // 75
    expect(severityOf(89)).toBe('amber');
    expect(severityOf(QUOTA_RED_THRESHOLD)).toBe('red'); // 90
    expect(severityOf(100)).toBe('red');
  });
});

describe('deriveQuotaRow — tightest-window selection & designed states', () => {
  it('is unknown when there is no blob', () => {
    expect(deriveQuotaRow(undefined, NOW)).toEqual({ state: 'unknown' });
  });

  it('surfaces the tightest (highest-percent) trusted window on the collapsed row', () => {
    const quota: ProviderQuota = {
      status: 'ok',
      observedAt: NOW - 40_000,
      modelWindows: [{ kind: 'weekly-model', usedPercent: 88, resetsAt: NOW + 6 * DAY, label: 'Fable' }],
      session: { kind: 'session', usedPercent: 36, resetsAt: NOW + 2 * HOUR },
      weekly: { kind: 'weekly', usedPercent: 21, resetsAt: NOW + 6 * DAY },
    };
    const row = deriveQuotaRow(quota, NOW);
    expect(row).toEqual({
      state: 'ok',
      usedPercent: 88,
      severity: 'amber',
      resetsAt: NOW + 6 * DAY,
      stale: false,
    });
  });

  it('reddens when the tightest window is at/above the red threshold', () => {
    const quota: ProviderQuota = {
      status: 'ok',
      observedAt: NOW,
      modelWindows: [],
      session: { kind: 'session', usedPercent: 92, resetsAt: NOW + HOUR },
    };
    expect(deriveQuotaRow(quota, NOW)).toMatchObject({ state: 'ok', usedPercent: 92, severity: 'red' });
  });

  it('flags stale past the 12-minute threshold while still showing last-known numbers', () => {
    const quota: ProviderQuota = {
      status: 'ok',
      observedAt: NOW - 13 * 60 * 1000,
      modelWindows: [],
      session: { kind: 'session', usedPercent: 44, resetsAt: NOW + 2 * HOUR },
    };
    expect(deriveQuotaRow(quota, NOW)).toMatchObject({ state: 'ok', stale: true });
  });

  it('fails closed to unknown once every window has expired', () => {
    const quota: ProviderQuota = {
      status: 'ok',
      observedAt: NOW - 6 * HOUR,
      modelWindows: [],
      session: { kind: 'session', usedPercent: 50, resetsAt: NOW - HOUR },
    };
    expect(deriveQuotaRow(quota, NOW)).toEqual({ state: 'unknown' });
  });
});

describe('deriveWindowList — expanded popover content', () => {
  it('lists every window with its label, percent, severity, and reset', () => {
    const quota: ProviderQuota = {
      status: 'ok',
      observedAt: NOW,
      session: { kind: 'session', usedPercent: 36, resetsAt: NOW + 2 * HOUR },
      weekly: { kind: 'weekly', usedPercent: 21, resetsAt: NOW + 6 * DAY },
      modelWindows: [{ kind: 'weekly-model', usedPercent: 88, resetsAt: NOW + 6 * DAY, label: 'Fable' }],
    };
    expect(deriveWindowList(quota)).toEqual([
      { kind: 'session', label: 'Session (5h)', usedPercent: 36, severity: 'normal', resetsAt: NOW + 2 * HOUR },
      { kind: 'weekly', label: 'Weekly · all models', usedPercent: 21, severity: 'normal', resetsAt: NOW + 6 * DAY },
      { kind: 'weekly-model', label: 'Weekly · Fable', usedPercent: 88, severity: 'amber', resetsAt: NOW + 6 * DAY },
    ]);
  });

  it('labels an unlabelled model window generically', () => {
    expect(windowLabel({ kind: 'weekly-model', usedPercent: 10, resetsAt: null })).toBe('Weekly · model');
  });

  it('keeps a best-effort null-reset window (percent preserved, resetsAt null) — #255', () => {
    const quota: ProviderQuota = {
      status: 'ok',
      observedAt: NOW,
      modelWindows: [],
      session: { kind: 'session', usedPercent: 63, resetsAt: null },
    };
    expect(deriveWindowList(quota)).toEqual([
      { kind: 'session', label: 'Session (5h)', usedPercent: 63, severity: 'normal', resetsAt: null },
    ]);
  });
});

describe('formatRelativeReset', () => {
  it('renders days, hours, or minutes and "now" past reset; null when unknown', () => {
    expect(formatRelativeReset(NOW + 6 * DAY + 2 * HOUR, NOW)).toBe('6d 2h');
    expect(formatRelativeReset(NOW + 2 * HOUR + 10 * 60_000, NOW)).toBe('2h 10m');
    expect(formatRelativeReset(NOW + 9 * 60_000, NOW)).toBe('9m');
    expect(formatRelativeReset(NOW - 5000, NOW)).toBe('now');
    expect(formatRelativeReset(null, NOW)).toBeNull();
  });
});

describe('formatAbsoluteReset', () => {
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'UTC';
  });
  afterAll(() => {
    process.env.TZ = original;
  });

  it('renders a friendly absolute timestamp for the popover (UTC-pinned)', () => {
    expect(formatAbsoluteReset(NOW)).toBe('Jul 17, 11:00 AM');
    expect(formatAbsoluteReset(NOW + 2 * HOUR + 20 * 60_000)).toBe('Jul 17, 1:20 PM');
  });
});

describe('formatUsedPercent — one formatter for every provider (rounding parity)', () => {
  it('rounds fractional percents the way a provider that reports raw floats would (Codex-style)', () => {
    expect(formatUsedPercent(41.7)).toBe(42);
    expect(formatUsedPercent(41.4)).toBe(41);
  });

  it('passes through an already-integer percent unchanged (Claude-style)', () => {
    expect(formatUsedPercent(36)).toBe(36);
  });
});

describe('minutesAgo', () => {
  it('rounds elapsed minutes and never goes negative', () => {
    expect(minutesAgo(NOW - 9 * 60_000, NOW)).toBe(9);
    expect(minutesAgo(NOW + 5000, NOW)).toBe(0);
  });
});
