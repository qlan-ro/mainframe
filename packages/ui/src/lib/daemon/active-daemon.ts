import type { DaemonTarget } from '@qlan-ro/mainframe-types';

let active: DaemonTarget = { id: 'local', kind: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:0', token: null };
const listeners = new Set<(t: DaemonTarget) => void>();

export function getActiveDaemon(): DaemonTarget {
  return active;
}
export function setActiveDaemon(t: DaemonTarget): void {
  active = t;
  for (const cb of listeners) cb(t);
}
/**
 * Swap the bearer token of the active target in place after a re-pair.
 *
 * Deliberately not `setActiveDaemon` through `switchTo`: that disposes the WS,
 * the controllers and the PTYs and remounts the daemon-scoped subtree, which
 * would end the session the user is repairing.
 */
export function updateActiveDaemonToken(id: string, token: string): void {
  if (active.id !== id) return;
  setActiveDaemon({ ...active, token });
}

export function subscribeActiveDaemon(cb: (t: DaemonTarget) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
