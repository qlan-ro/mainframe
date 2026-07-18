import type { ProviderQuota } from '@qlan-ro/mainframe-types';
import { deriveProviderStatus } from './status.js';

export function unknownProviderQuota(now: number): ProviderQuota {
  return { status: 'unknown', modelWindows: [], observedAt: now };
}

/**
 * On a pull failure, keep the last-known blob and let expiry/staleness rules — not the
 * failure itself — decide whether the provider still reads as trustworthy.
 */
export function handlePullFailure(prior: ProviderQuota | undefined, now: number): ProviderQuota {
  if (!prior) return unknownProviderQuota(now);
  return { ...prior, status: deriveProviderStatus(prior, now) };
}
