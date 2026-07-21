import type { ProviderQuota, QuotaWindow } from '@qlan-ro/mainframe-types';
import { SESSION_WINDOW_DURATION_MS, STALE_THRESHOLD_MS, WEEKLY_WINDOW_DURATION_MS } from './constants.js';

function windowDurationMs(kind: QuotaWindow['kind']): number {
  return kind === 'session' ? SESSION_WINDOW_DURATION_MS : WEEKLY_WINDOW_DURATION_MS;
}

/**
 * A null resetsAt is synthesized into a ceiling so a window can't display forever.
 * The ceiling anchors to the window's own observedAt when set, so a data-free push
 * (which bumps the blob-level observedAt) can't float this window's ceiling forward.
 */
export function effectiveResetAt(window: QuotaWindow, observedAt: number): number {
  return window.resetsAt ?? (window.observedAt ?? observedAt) + windowDurationMs(window.kind);
}

export function isWindowTrusted(window: QuotaWindow, observedAt: number, now: number): boolean {
  return now < effectiveResetAt(window, observedAt);
}

/** Staleness is a separate signal from expiry: it can fire well before a window's ceiling. */
export function isProviderStale(quota: ProviderQuota, now: number): boolean {
  return now - quota.observedAt >= STALE_THRESHOLD_MS;
}

export function collectQuotaWindows(quota: ProviderQuota): QuotaWindow[] {
  return [quota.session, quota.weekly, ...quota.modelWindows].filter((window): window is QuotaWindow => window != null);
}
