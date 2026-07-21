import { describe, it, expect } from 'vitest';
import type { ProviderQuota, QuotaWindow } from '@qlan-ro/mainframe-types';
import { selectTightestWindow } from '../tightest-window.js';

const NOW = 1_720_000_000_000;

describe('selectTightestWindow', () => {
  it('picks the window with the highest usedPercent among trusted windows', () => {
    const session: QuotaWindow = { kind: 'session', usedPercent: 40, resetsAt: NOW + 10_000 };
    const weekly: QuotaWindow = { kind: 'weekly', usedPercent: 75, resetsAt: NOW + 10_000 };
    const quota: ProviderQuota = { status: 'ok', session, weekly, modelWindows: [], observedAt: NOW };

    expect(selectTightestWindow(quota, NOW)).toBe(weekly);
  });

  it('ignores expired windows even when numerically higher', () => {
    const session: QuotaWindow = { kind: 'session', usedPercent: 90, resetsAt: NOW + 10_000 };
    const weekly: QuotaWindow = { kind: 'weekly', usedPercent: 95, resetsAt: NOW - 1 };
    const quota: ProviderQuota = { status: 'ok', session, weekly, modelWindows: [], observedAt: NOW };

    expect(selectTightestWindow(quota, NOW)).toBe(session);
  });

  it('returns undefined when every window has expired', () => {
    const session: QuotaWindow = { kind: 'session', usedPercent: 90, resetsAt: NOW - 1 };
    const quota: ProviderQuota = { status: 'unknown', session, modelWindows: [], observedAt: NOW };

    expect(selectTightestWindow(quota, NOW)).toBeUndefined();
  });

  it('considers model windows alongside session and weekly', () => {
    const session: QuotaWindow = { kind: 'session', usedPercent: 10, resetsAt: NOW + 10_000 };
    const model: QuotaWindow = { kind: 'weekly-model', usedPercent: 88, resetsAt: NOW + 10_000, label: 'opus' };
    const quota: ProviderQuota = { status: 'ok', session, modelWindows: [model], observedAt: NOW };

    expect(selectTightestWindow(quota, NOW)).toBe(model);
  });

  it('breaks ties by keeping the earlier window in session/weekly/model order', () => {
    const session: QuotaWindow = { kind: 'session', usedPercent: 50, resetsAt: NOW + 10_000 };
    const weekly: QuotaWindow = { kind: 'weekly', usedPercent: 50, resetsAt: NOW + 10_000 };
    const quota: ProviderQuota = { status: 'ok', session, weekly, modelWindows: [], observedAt: NOW };

    expect(selectTightestWindow(quota, NOW)).toBe(session);
  });
});
