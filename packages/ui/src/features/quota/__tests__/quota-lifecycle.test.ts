/**
 * Direct coverage for the pure lifecycle mirror (`quota-lifecycle.ts`) — the UI's
 * verbatim copy of `packages/core/src/quota`. The format tests always pass an
 * explicit `resetsAt`; these lock the branches they never reach, chiefly the
 * synthesized null-reset ceiling (#255), so the copy can't silently drift.
 */
import { describe, it, expect } from 'vitest';
import type { ProviderQuota, QuotaWindow } from '@qlan-ro/mainframe-types';
import {
  SESSION_WINDOW_DURATION_MS,
  WEEKLY_WINDOW_DURATION_MS,
  collectQuotaWindows,
  deriveProviderStatus,
  effectiveResetAt,
  isProviderStale,
  isWindowTrusted,
  selectTightestWindow,
} from '../quota-lifecycle';

const NOW = 1_752_750_000_000;
const HOUR = 3_600_000;

describe('effectiveResetAt — null reset synthesizes a per-kind ceiling', () => {
  it('uses the provider resetsAt verbatim when present', () => {
    const w: QuotaWindow = { kind: 'session', usedPercent: 10, resetsAt: NOW + HOUR };
    expect(effectiveResetAt(w, NOW - 5000)).toBe(NOW + HOUR);
  });

  it('synthesizes observedAt + 5h for a null-reset session window', () => {
    const w: QuotaWindow = { kind: 'session', usedPercent: 10, resetsAt: null };
    expect(effectiveResetAt(w, NOW)).toBe(NOW + SESSION_WINDOW_DURATION_MS);
    expect(SESSION_WINDOW_DURATION_MS).toBe(5 * HOUR);
  });

  it('synthesizes observedAt + 7d for a null-reset weekly / weekly-model window', () => {
    const weekly: QuotaWindow = { kind: 'weekly', usedPercent: 10, resetsAt: null };
    const model: QuotaWindow = { kind: 'weekly-model', usedPercent: 10, resetsAt: null };
    expect(effectiveResetAt(weekly, NOW)).toBe(NOW + WEEKLY_WINDOW_DURATION_MS);
    expect(effectiveResetAt(model, NOW)).toBe(NOW + WEEKLY_WINDOW_DURATION_MS);
    expect(WEEKLY_WINDOW_DURATION_MS).toBe(7 * 24 * HOUR);
  });

  it('anchors the null-reset ceiling to the window observedAt, ignoring the blob observedAt', () => {
    const w: QuotaWindow = { kind: 'session', usedPercent: 10, resetsAt: null, observedAt: NOW - 4 * HOUR };
    // The blob observedAt (NOW) is bumped by a data-free push; the window's own observedAt
    // must still anchor the ceiling so it doesn't float forward.
    expect(effectiveResetAt(w, NOW)).toBe(NOW - 4 * HOUR + SESSION_WINDOW_DURATION_MS);
  });
});

describe('isWindowTrusted — trusted until the (real or synthesized) ceiling passes', () => {
  it('trusts a null-reset session window inside its synthesized 5h ceiling', () => {
    const w: QuotaWindow = { kind: 'session', usedPercent: 50, resetsAt: null };
    expect(isWindowTrusted(w, NOW - 4 * HOUR, NOW)).toBe(true);
    expect(isWindowTrusted(w, NOW - 6 * HOUR, NOW)).toBe(false);
  });

  it('expires a window the moment its explicit reset passes', () => {
    const w: QuotaWindow = { kind: 'session', usedPercent: 50, resetsAt: NOW - 1 };
    expect(isWindowTrusted(w, NOW - HOUR, NOW)).toBe(false);
  });
});

describe('collectQuotaWindows — session, weekly, then model windows; skips absent', () => {
  it('flattens present windows in order and drops undefined ones', () => {
    const quota: ProviderQuota = {
      status: 'ok',
      observedAt: NOW,
      session: { kind: 'session', usedPercent: 12, resetsAt: NOW + HOUR },
      modelWindows: [{ kind: 'weekly-model', usedPercent: 40, resetsAt: NOW + HOUR, label: 'Fable' }],
    };
    expect(collectQuotaWindows(quota).map((w) => w.kind)).toEqual(['session', 'weekly-model']);
  });
});

describe('deriveProviderStatus — fail-closed when no window is trusted', () => {
  it('is ok while at least one window is trusted, unknown once all expire', () => {
    const live: ProviderQuota = {
      status: 'ok',
      observedAt: NOW,
      modelWindows: [],
      session: { kind: 'session', usedPercent: 50, resetsAt: NOW + HOUR },
    };
    const expired: ProviderQuota = { ...live, session: { kind: 'session', usedPercent: 50, resetsAt: NOW - HOUR } };
    expect(deriveProviderStatus(live, NOW)).toBe('ok');
    expect(deriveProviderStatus(expired, NOW)).toBe('unknown');
  });
});

describe('selectTightestWindow — highest-percent trusted window, ignoring expired ones', () => {
  it('returns the max-usedPercent trusted window', () => {
    const quota: ProviderQuota = {
      status: 'ok',
      observedAt: NOW,
      session: { kind: 'session', usedPercent: 36, resetsAt: NOW + HOUR },
      weekly: { kind: 'weekly', usedPercent: 88, resetsAt: NOW + HOUR },
      modelWindows: [],
    };
    expect(selectTightestWindow(quota, NOW)?.usedPercent).toBe(88);
  });

  it('excludes an expired higher window and picks the tightest live one', () => {
    const quota: ProviderQuota = {
      status: 'ok',
      observedAt: NOW,
      session: { kind: 'session', usedPercent: 36, resetsAt: NOW + HOUR },
      weekly: { kind: 'weekly', usedPercent: 99, resetsAt: NOW - HOUR },
      modelWindows: [],
    };
    expect(selectTightestWindow(quota, NOW)?.usedPercent).toBe(36);
  });

  it('returns undefined when every window has expired', () => {
    const quota: ProviderQuota = {
      status: 'ok',
      observedAt: NOW,
      modelWindows: [],
      session: { kind: 'session', usedPercent: 50, resetsAt: NOW - HOUR },
    };
    expect(selectTightestWindow(quota, NOW)).toBeUndefined();
  });
});

describe('isProviderStale — fires past the 12-minute threshold', () => {
  it('is fresh under 12m and stale at/after it', () => {
    expect(isProviderStale({ status: 'ok', observedAt: NOW - 11 * 60_000, modelWindows: [] }, NOW)).toBe(false);
    expect(isProviderStale({ status: 'ok', observedAt: NOW - 12 * 60_000, modelWindows: [] }, NOW)).toBe(true);
  });
});
