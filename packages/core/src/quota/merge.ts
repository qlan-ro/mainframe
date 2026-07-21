import type { ProviderQuota, QuotaWindow } from '@qlan-ro/mainframe-types';
import { deriveProviderStatus } from './status.js';

/** A harvested partial update. Undefined fields keep the prior value; nothing here ever clears one. */
export interface ProviderQuotaUpdate {
  session?: QuotaWindow;
  weekly?: QuotaWindow;
  modelWindows?: QuotaWindow[];
  accountIdentity?: string;
  observedAt: number;
}

/** Stamp the harvest time onto a window carrying real data so its ceiling anchors per-window. */
export function stampWindowObservedAt(window: QuotaWindow | undefined, observedAt: number): QuotaWindow | undefined {
  return window ? { ...window, observedAt } : undefined;
}

/** Sparse rolling merge: an omitted field keeps whatever the prior blob held. */
export function mergeProviderQuota(
  prior: ProviderQuota | undefined,
  update: ProviderQuotaUpdate,
  now: number,
): ProviderQuota {
  const merged: ProviderQuota = {
    status: 'unknown',
    session: stampWindowObservedAt(update.session, update.observedAt) ?? prior?.session,
    weekly: stampWindowObservedAt(update.weekly, update.observedAt) ?? prior?.weekly,
    modelWindows: mergeModelWindows(prior?.modelWindows, update.modelWindows, update.observedAt),
    observedAt: update.observedAt,
    accountIdentity: update.accountIdentity ?? prior?.accountIdentity,
  };
  merged.status = deriveProviderStatus(merged, now);
  return merged;
}

/**
 * Upsert model windows by label (never wholesale-replace): each incoming entry updates its
 * matching-label window; labels absent from the update keep their prior entry (expiry, not
 * a data-free push, removes a stale one). An omitted update array keeps all prior windows.
 */
function mergeModelWindows(
  prior: QuotaWindow[] | undefined,
  update: QuotaWindow[] | undefined,
  observedAt: number,
): QuotaWindow[] {
  if (!update) return prior ?? [];
  const byLabel = new Map<string, QuotaWindow>();
  for (const window of prior ?? []) byLabel.set(window.label ?? '', window);
  for (const window of update) byLabel.set(window.label ?? '', { ...window, observedAt });
  return [...byLabel.values()];
}
