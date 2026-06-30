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
export function subscribeActiveDaemon(cb: (t: DaemonTarget) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
