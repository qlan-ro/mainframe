/**
 * Pure quota-lifecycle helpers — a verbatim mirror of `packages/core/src/quota/`
 * (window-lifecycle.ts / status.ts / tightest-window.ts / constants.ts). The UI
 * package must NOT depend on the `@qlan-ro/mainframe-core` sidecar process, so
 * this copy stays in sync with the source (same pattern as `resolveSkillName`).
 * No quota logic is authored in React — components consume these + the
 * view-model derivations in `quota-format.ts`.
 */
import type { ProviderQuota, QuotaWindow } from '@qlan-ro/mainframe-types';

/** How long a session window stays trusted when the provider gives no resetsAt. */
export const SESSION_WINDOW_DURATION_MS = 5 * 60 * 60 * 1000;

/** How long a weekly/weekly-model window stays trusted when the provider gives no resetsAt. */
export const WEEKLY_WINDOW_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

/** Age past which a provider blob is flagged stale, ahead of its expiry ceiling. */
export const STALE_THRESHOLD_MS = 12 * 60 * 1000;

function windowDurationMs(kind: QuotaWindow['kind']): number {
  return kind === 'session' ? SESSION_WINDOW_DURATION_MS : WEEKLY_WINDOW_DURATION_MS;
}

/** A null resetsAt is synthesized into a ceiling so a window can't display forever. */
export function effectiveResetAt(window: QuotaWindow, observedAt: number): number {
  return window.resetsAt ?? observedAt + windowDurationMs(window.kind);
}

export function isWindowTrusted(window: QuotaWindow, observedAt: number, now: number): boolean {
  return now < effectiveResetAt(window, observedAt);
}

/** Staleness is a separate signal from expiry: it can fire well before a window's ceiling. */
export function isProviderStale(quota: ProviderQuota, now: number): boolean {
  return now - quota.observedAt >= STALE_THRESHOLD_MS;
}

export function collectQuotaWindows(quota: ProviderQuota): QuotaWindow[] {
  return [quota.session, quota.weekly, ...quota.modelWindows].filter(
    (window): window is QuotaWindow => window != null,
  );
}

/** Fail-closed (#251): zero trusted windows fails the whole provider to `unknown`. */
export function deriveProviderStatus(quota: ProviderQuota, now: number): 'ok' | 'unknown' {
  const hasTrustedWindow = collectQuotaWindows(quota).some((window) =>
    isWindowTrusted(window, quota.observedAt, now),
  );
  return hasTrustedWindow ? 'ok' : 'unknown';
}

/** The single number that will actually stop the user: max usedPercent among trusted windows. */
export function selectTightestWindow(quota: ProviderQuota, now: number): QuotaWindow | undefined {
  const trusted = collectQuotaWindows(quota).filter((window) =>
    isWindowTrusted(window, quota.observedAt, now),
  );
  if (trusted.length === 0) return undefined;
  return trusted.reduce((tightest, window) => (window.usedPercent > tightest.usedPercent ? window : tightest));
}
