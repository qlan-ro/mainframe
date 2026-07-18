/**
 * Pure view-model derivations + formatting for the quota surface. All quota
 * reasoning lives here (over the mirrored lifecycle helpers), never in the React
 * components, so the render layer is pure wiring.
 */
import type { ProviderQuota, QuotaWindow } from '@qlan-ro/mainframe-types';
import {
  collectQuotaWindows,
  deriveProviderStatus,
  isProviderStale,
  selectTightestWindow,
} from './quota-lifecycle';

/** Near-wall thresholds (tunable). At/above amber the ring warns; at/above red it alarms. */
export const QUOTA_AMBER_THRESHOLD = 75;
export const QUOTA_RED_THRESHOLD = 90;

export type QuotaSeverity = 'normal' | 'amber' | 'red';

export function severityOf(usedPercent: number): QuotaSeverity {
  if (usedPercent >= QUOTA_RED_THRESHOLD) return 'red';
  if (usedPercent >= QUOTA_AMBER_THRESHOLD) return 'amber';
  return 'normal';
}

/** Provider display metadata keyed by adapter id. Both are always shown on the card. */
export const QUOTA_PROVIDERS: readonly { id: string; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
];

/** Collapsed-row view: the tightest window (or a designed unknown), plus staleness. */
export type QuotaRowVm =
  | { state: 'unknown' }
  | {
      state: 'ok';
      usedPercent: number;
      severity: QuotaSeverity;
      resetsAt: number | null;
      stale: boolean;
    };

export function deriveQuotaRow(quota: ProviderQuota | undefined, now: number): QuotaRowVm {
  if (!quota || deriveProviderStatus(quota, now) === 'unknown') return { state: 'unknown' };
  const tightest = selectTightestWindow(quota, now);
  if (!tightest) return { state: 'unknown' };
  return {
    state: 'ok',
    usedPercent: tightest.usedPercent,
    severity: severityOf(tightest.usedPercent),
    resetsAt: tightest.resetsAt,
    stale: isProviderStale(quota, now),
  };
}

/** One row per window for the expanded popover. */
export interface QuotaWindowVm {
  kind: QuotaWindow['kind'];
  label: string;
  usedPercent: number;
  severity: QuotaSeverity;
  resetsAt: number | null;
}

export function windowLabel(window: QuotaWindow): string {
  switch (window.kind) {
    case 'session':
      return 'Session (5h)';
    case 'weekly':
      return 'Weekly · all models';
    case 'weekly-model':
      return window.label ? `Weekly · ${window.label}` : 'Weekly · model';
  }
}

export function deriveWindowList(quota: ProviderQuota): QuotaWindowVm[] {
  return collectQuotaWindows(quota).map((window) => ({
    kind: window.kind,
    label: windowLabel(window),
    usedPercent: window.usedPercent,
    severity: severityOf(window.usedPercent),
    resetsAt: window.resetsAt,
  }));
}

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

/** Friendly relative reset for the ambient row ("resets in 2h 10m"); null when unknown. */
export function formatRelativeReset(resetsAt: number | null, now: number): string | null {
  if (resetsAt == null) return null;
  const delta = resetsAt - now;
  if (delta <= 0) return 'now';
  const days = Math.floor(delta / DAY_MS);
  const hours = Math.floor((delta % DAY_MS) / HOUR_MS);
  const mins = Math.floor((delta % HOUR_MS) / MIN_MS);
  if (days >= 1) return `${days}d ${hours}h`;
  if (hours >= 1) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** Absolute reset timestamp for the popover ("Jul 17, 4:20 PM"). */
export function formatAbsoluteReset(resetsAt: number): string {
  return new Date(resetsAt).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Minutes since a blob was observed, for the "N min ago" popover freshness note. */
export function minutesAgo(observedAt: number, now: number): number {
  return Math.max(0, Math.round((now - observedAt) / MIN_MS));
}
