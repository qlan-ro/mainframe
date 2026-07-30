/**
 * Per-daemon "needs re-pair" marker, keyed by daemon id.
 *
 * Deliberately has no import from `@/lib/host` (the keyring): a 401/403 must
 * only ever flip this in-memory marker, never touch a stored credential.
 * Not included in `resetDaemonScopedStores` — markers are keyed *by* daemon
 * id, so switching the active daemon must not erase another daemon's marker.
 */
const failedIds = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
let snapshot: { version: number } = { version };

function notify(): void {
  version += 1;
  snapshot = { version };
  for (const cb of listeners) cb();
}

export function markAuthFailure(id: string): void {
  if (failedIds.has(id)) return;
  failedIds.add(id);
  notify();
}

export function clearAuthFailure(id: string): void {
  if (!failedIds.has(id)) return;
  failedIds.delete(id);
  notify();
}

export function hasAuthFailure(id: string): boolean {
  return failedIds.has(id);
}

export function subscribeAuthFailures(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Stable reference for `useSyncExternalStore` — bumps only when a marker actually changes. */
export function getAuthFailureSnapshot(): { version: number } {
  return snapshot;
}
