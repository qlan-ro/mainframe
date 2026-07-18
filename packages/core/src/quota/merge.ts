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

/** Sparse rolling merge: an omitted field keeps whatever the prior blob held. */
export function mergeProviderQuota(
  prior: ProviderQuota | undefined,
  update: ProviderQuotaUpdate,
  now: number,
): ProviderQuota {
  const merged: ProviderQuota = {
    status: 'unknown',
    session: update.session ?? prior?.session,
    weekly: update.weekly ?? prior?.weekly,
    modelWindows: update.modelWindows ?? prior?.modelWindows ?? [],
    observedAt: update.observedAt,
    accountIdentity: update.accountIdentity ?? prior?.accountIdentity,
  };
  merged.status = deriveProviderStatus(merged, now);
  return merged;
}
