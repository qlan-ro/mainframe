/**
 * Module-level home for each URL tab's tunnel claim, keyed by `tabId`
 * (#281, D10, AC12, review-fix findings 1+3).
 *
 * A `TunnelClaim` used to live in `useTunnelClaim`'s component-local
 * `useReducer` state, so it reset to `null` on every mount. The consumer
 * registry it feeds (`tunnel-consumers.ts`) is module-level and survives a
 * session-switch unmount — so a remount against an already-`ready` port never
 * re-issues a start (nothing is pending), the claim came back empty, and the
 * next registration silently downgraded a real `started: true` to `false`,
 * leaking the tunnel it exclusively started.
 *
 * Storing the claim here, alongside the tab id the consumer registry already
 * uses, lets a remount rehydrate its own prior evidence instead of losing it.
 * Dropped only where a tab's consumer record is dropped — `tunnel-consumers.ts`
 * — never on unmount, since unmounting (a session switch) is not closing.
 */
import type { TunnelClaim } from './tunnel-claim';

let claims: Record<string, TunnelClaim | null> = {};

/** Seeds `useTunnelClaim`'s reducer on (re)mount. */
export function getStoredClaim(tabId: string): TunnelClaim | null {
  return claims[tabId] ?? null;
}

/** Written back whenever the claim reducer produces a new value. */
export function setStoredClaim(tabId: string, claim: TunnelClaim | null): void {
  if (claims[tabId] === claim) return;
  claims = { ...claims, [tabId]: claim };
}

/** Companion to `releaseConsumers`: drop the claims for tabs whose consumer record just left. */
export function dropStoredClaims(tabIds: string[]): void {
  if (tabIds.length === 0) return;
  const next = { ...claims };
  for (const id of tabIds) delete next[id];
  claims = next;
}

/** Companion to `clearConsumers`: daemon-switch cleanup. */
export function clearStoredClaims(): void {
  claims = {};
}
