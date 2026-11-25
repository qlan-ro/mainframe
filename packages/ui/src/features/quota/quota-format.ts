/**
 * Pure view-model derivations + formatting for the quota surface. All quota
 * reasoning lives here (over the mirrored lifecycle helpers), never in the React
 * components, so the render layer is pure wiring.
 */
import type { ProviderQuota, QuotaWindow } from '@qlan-ro/mainframe-types';
import { collectQuotaWindows, deriveProviderStatus, isProviderStale, isWindowTrusted } from './quota-lifecycle';

/** Near-wall thresholds (tunable). At/above amber the capsule pins and warns; at/above red it alarms. */
export const QUOTA_AMBER_THRESHOLD = 75;
export const QUOTA_RED_THRESHOLD = 90;

export type QuotaSeverity = 'normal' | 'amber' | 'red';

/** Display rounding for a used-percent value — providers disagree on precision. */
export function formatUsedPercent(usedPercent: number): number {
  return Math.round(usedPercent);
}

export function severityOf(usedPercent: number): QuotaSeverity {
  if (usedPercent >= QUOTA_RED_THRESHOLD) return 'red';
  if (usedPercent >= QUOTA_AMBER_THRESHOLD) return 'amber';
  return 'normal';
}

/** Provider display metadata keyed by adapter id. Both always get a section in the usage popover. */
export const QUOTA_PROVIDERS: readonly { id: string; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
];

/** The window name the capsule shows after the provider name: the popover label without its `·`, since the capsule's own dot already sits before it. */
export function capsuleWindowName(window: QuotaWindow): string {
  return window.kind === 'weekly-model' ? `Weekly ${window.label ?? 'model'}` : windowLabel(window);
}

/**
 * One step of the title-bar capsule's cycle: a single trusted window of one
 * provider. The cycle runs provider by provider, each provider's windows
 * smallest first (session, weekly, then the per-model weeklies).
 */
export interface CapsuleItemVm {
  /** Stable across re-derivations, so the cycle can stay on the same window when data updates. */
  key: string;
  providerId: string;
  providerLabel: string;
  kind: QuotaWindow['kind'];
  /** "Weekly Fable" — the label the capsule row shows. */
  name: string;
  label: string;
  usedPercent: number;
  severity: QuotaSeverity;
  resetsAt: number | null;
  stale: boolean;
}

export function deriveCapsuleItems(byId: Record<string, ProviderQuota | undefined>, now: number): CapsuleItemVm[] {
  return QUOTA_PROVIDERS.flatMap((provider) => {
    const quota = byId[provider.id];
    if (!quota || deriveProviderStatus(quota, now) === 'unknown') return [];
    const stale = isProviderStale(quota, now);
    return collectQuotaWindows(quota)
      .filter((window) => isWindowTrusted(window, quota.observedAt, now))
      .map((window) => {
        const label = windowLabel(window);
        return {
          key: `${provider.id}:${label}`,
          providerId: provider.id,
          providerLabel: provider.label,
          kind: window.kind,
          name: capsuleWindowName(window),
          label,
          usedPercent: window.usedPercent,
          severity: severityOf(window.usedPercent),
          resetsAt: window.resetsAt,
          stale,
        };
      });
  });
}

/**
 * The window the capsule pins instead of cycling: the fullest one at or above
 * the amber threshold. `null` while every window is below it.
 */
export function pinnedCapsuleIndex(items: readonly CapsuleItemVm[]): number | null {
  let pinned: number | null = null;
  let pinnedPercent = -Infinity;
  items.forEach((item, i) => {
    if (item.severity === 'normal' || item.usedPercent <= pinnedPercent) return;
    pinned = i;
    pinnedPercent = item.usedPercent;
  });
  return pinned;
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
      return '5-hour';
    case 'weekly':
      return 'Weekly';
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

/** Friendly relative reset for the capsule and popover ("2h 10m"); null when unknown. */
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
