/** Synthetic accountIdentity used for keyless auth (API key, Bedrock) — carries no quota. */
export const UNKNOWN_ACCOUNT_IDENTITY = 'identity:unknown';

/** Compound key (#259): a same-provider account swap naturally lands on a fresh, empty key. */
export function computeQuotaKey(adapterId: string, accountIdentity: string | undefined): string {
  return `${adapterId}:${accountIdentity ?? UNKNOWN_ACCOUNT_IDENTITY}`;
}

/**
 * A transient identity-read failure (freshIdentity === null) reuses the caller's last-known
 * identity so a healthy gauge doesn't flicker to unknown on a momentary file lock.
 */
export function resolveAccountIdentity(
  freshIdentity: string | null,
  lastKnownIdentity: string | undefined,
): string | undefined {
  return freshIdentity ?? lastKnownIdentity;
}
