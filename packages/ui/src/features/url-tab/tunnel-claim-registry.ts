/**
 * Module-level home for each URL tab's tunnel claim, keyed by `tabId`
 * (#281, D10, AC12, review-fix findings 1+3+NEW).
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
 *
 * The `daemon-state` signal — the one that can *revoke* a claim — used to be
 * dispatched from a `useEffect` in `useTunnelClaim`, so it died with the same
 * unmount this module was built to survive: the daemon could drop the tunnel
 * and hand the port to a foreign consumer while the tab was unmounted, the
 * claim would never observe either, and a remount would rehydrate as owner and
 * later stop a tunnel it doesn't own. This module now applies `daemon-state`
 * to every stored claim itself, from a subscription to the port-tunnels store
 * that is installed once at import time and outlives any component. Only the
 * action-scoped signals (`rebind`/`start-issued`/`start-rejected`/
 * `local-clear`) still come from the acting component; `useTunnelClaim` is a
 * reader of whatever this module has already decided.
 */
import { usePortTunnelsStore } from '@/store/port-tunnels';
import { claimReducer, entryDaemonState, type ClaimSignal, type TunnelClaim } from './tunnel-claim';

let claims: Record<string, TunnelClaim | null> = {};
const listeners = new Map<string, Set<() => void>>();

function notify(tabId: string): void {
  const set = listeners.get(tabId);
  if (set === undefined) return;
  for (const listener of set) listener();
}

/** Current claim for a tab, read fresh on every render — this module is the source of truth. */
export function getStoredClaim(tabId: string): TunnelClaim | null {
  return claims[tabId] ?? null;
}

/** `useSyncExternalStore` subscription so a mounted tab re-renders when its claim changes. */
export function subscribeClaim(tabId: string, listener: () => void): () => void {
  let set = listeners.get(tabId);
  if (set === undefined) {
    set = new Set();
    listeners.set(tabId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(tabId);
  };
}

function setStoredClaim(tabId: string, claim: TunnelClaim | null): void {
  if (claims[tabId] === claim) return;
  claims = { ...claims, [tabId]: claim };
  notify(tabId);
}

/** Runs one `ClaimSignal` through the reducer for `tabId` and stores the result. */
export function noteClaim(tabId: string, signal: ClaimSignal): void {
  setStoredClaim(tabId, claimReducer(getStoredClaim(tabId), signal));
}

/** Companion to `releaseConsumers`: drop the claims for tabs whose consumer record just left. */
export function dropStoredClaims(tabIds: string[]): void {
  if (tabIds.length === 0) return;
  const next = { ...claims };
  for (const id of tabIds) delete next[id];
  claims = next;
  for (const id of tabIds) notify(id);
}

/** Companion to `clearConsumers`: daemon-switch cleanup. */
export function clearStoredClaims(): void {
  const ids = Object.keys(claims);
  claims = {};
  for (const id of ids) notify(id);
}

// Mount-independent revocation (review-fix NEW finding): mirrors every write
// the port-tunnels store makes, not just the ones a mounted tab's own effect
// happens to observe, so a claim is revoked even while its tab is unmounted.
usePortTunnelsStore.subscribe((state, prev) => {
  for (const [tabId, claim] of Object.entries(claims)) {
    if (claim === null) continue;
    const entry = state.byPort[claim.port];
    if (entry === prev.byPort[claim.port]) continue;
    noteClaim(tabId, {
      type: 'daemon-state',
      httpPort: claim.httpPort,
      port: claim.port,
      state: entryDaemonState(entry),
    });
  }
});
