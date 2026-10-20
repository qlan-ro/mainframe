import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ProviderQuota } from '@qlan-ro/mainframe-types';
import {
  QUOTA_AMBER_THRESHOLD,
  QUOTA_RED_THRESHOLD,
  capsuleWindowName,
  deriveCapsuleItems,
  deriveWindowList,
  formatAbsoluteReset,
  formatRelativeReset,
  formatUsedPercent,
  minutesAgo,
  pinnedCapsuleIndex,
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

describe('deriveCapsuleItems — the capsule cycle', () => {
  it('runs provider by provider, each provider smallest window first', () => {
    const claude: ProviderQuota = {
      status: 'ok',
      observedAt: NOW - 40_000,
      session: { kind: 'session', usedPercent: 3, resetsAt: NOW + 2 * HOUR },
      weekly: { kind: 'weekly', usedPercent: 41, resetsAt: NOW + 4 * DAY },
      modelWindows: [{ kind: 'weekly-model', usedPercent: 59, resetsAt: NOW + 6 * DAY, label: 'Fable' }],
    };
    const codex: ProviderQuota = {
      status: 'ok',
      observedAt: NOW,
      weekly: { kind: 'weekly', usedPercent: 17, resetsAt: NOW + 6 * DAY },
      modelWindows: [],
    };
    expect(deriveCapsuleItems({ codex, claude }, NOW)).toEqual([
      {
        key: 'claude:5-hour',
        providerId: 'claude',
        providerLabel: 'Claude',
        kind: 'session',
        name: '5-hour',
        label: '5-hour',
        usedPercent: 3,
        severity: 'normal',
        resetsAt: NOW + 2 * HOUR,
        stale: false,
      },
      {
        key: 'claude:Weekly',
        providerId: 'claude',
        providerLabel: 'Claude',
        kind: 'weekly',
        name: 'Weekly',
        label: 'Weekly',
        usedPercent: 41,
        severity: 'normal',
        resetsAt: NOW + 4 * DAY,
        stale: false,
      },
      {
        key: 'claude:Weekly · Fable',
        providerId: 'claude',
        providerLabel: 'Claude',
        kind: 'weekly-model',
        name: 'Weekly Fable',
        label: 'Weekly · Fable',
        usedPercent: 59,
        severity: 'normal',
        resetsAt: NOW + 6 * DAY,
        stale: false,
      },
      {
        key: 'codex:Weekly',
        providerId: 'codex',
        providerLabel: 'Codex',
        kind: 'weekly',
        name: 'Weekly',
        label: 'Weekly',
        usedPercent: 17,
        severity: 'normal',
        resetsAt: NOW + 6 * DAY,
        stale: false,
      },
    ]);
  });

  it('drops an expired window but keeps the provider while another window is trusted', () => {
    const claude: ProviderQuota = {
      status: 'ok',
      observedAt: NOW,
      session: { kind: 'session', usedPercent: 1, resetsAt: NOW - HOUR },
      weekly: { kind: 'weekly', usedPercent: 53, resetsAt: NOW + 6 * DAY },
      modelWindows: [],
    };
    expect(deriveCapsuleItems({ claude }, NOW).map((i) => i.key)).toEqual(['claude:Weekly']);
  });

  it('leaves out a provider with no blob or with every window expired', () => {
    const claude: ProviderQuota = {
      status: 'ok',
      observedAt: NOW - 6 * HOUR,
      modelWindows: [],
      session: { kind: 'session', usedPercent: 50, resetsAt: NOW - HOUR },
    };
    expect(deriveCapsuleItems({ claude, codex: undefined }, NOW)).toEqual([]);
  });

  it('flags stale past the 12-minute threshold while still showing last-known numbers', () => {
    const claude: ProviderQuota = {
      status: 'ok',
      observedAt: NOW - 13 * 60 * 1000,
      modelWindows: [],
      session: { kind: 'session', usedPercent: 44, resetsAt: NOW + 2 * HOUR },
    };
    expect(deriveCapsuleItems({ claude }, NOW)).toMatchObject([{ usedPercent: 44, stale: true }]);
  });
});

describe('pinnedCapsuleIndex', () => {
  const quotaAt = (session: number, weekly: number): ProviderQuota => ({
    status: 'ok',
    observedAt: NOW,
    session: { kind: 'session', usedPercent: session, resetsAt: NOW + HOUR },
    weekly: { kind: 'weekly', usedPercent: weekly, resetsAt: NOW + DAY },
    modelWindows: [],
  });

  it('keeps cycling while every window is under the amber threshold', () => {
    expect(pinnedCapsuleIndex(deriveCapsuleItems({ claude: quotaAt(3, 74) }, NOW))).toBeNull();
  });

  it('pins the window at the amber threshold', () => {
    expect(pinnedCapsuleIndex(deriveCapsuleItems({ claude: quotaAt(3, 75) }, NOW))).toBe(1);
  });

  it('pins the fullest window when several are past amber, across providers', () => {
    const items = deriveCapsuleItems({ claude: quotaAt(84, 20), codex: quotaAt(10, 96) }, NOW);
    expect(pinnedCapsuleIndex(items)).toBe(3);
    expect(items[3]).toMatchObject({ key: 'codex:Weekly', severity: 'red' });
  });
});

describe('capsuleWindowName', () => {
  it('names each window kind, a per-model weekly by its model without the separator dot', () => {
    expect(capsuleWindowName({ kind: 'session', usedPercent: 0, resetsAt: null })).toBe('5-hour');
    expect(capsuleWindowName({ kind: 'weekly', usedPercent: 0, resetsAt: null })).toBe('Weekly');
    expect(capsuleWindowName({ kind: 'weekly-model', usedPercent: 0, resetsAt: null, label: 'Fable' })).toBe(
      'Weekly Fable',
    );
    expect(capsuleWindowName({ kind: 'weekly-model', usedPercent: 0, resetsAt: null })).toBe('Weekly model');
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
      { kind: 'session', label: '5-hour', usedPercent: 36, severity: 'normal', resetsAt: NOW + 2 * HOUR },
      { kind: 'weekly', label: 'Weekly', usedPercent: 21, severity: 'normal', resetsAt: NOW + 6 * DAY },
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
      { kind: 'session', label: '5-hour', usedPercent: 63, severity: 'normal', resetsAt: null },
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
