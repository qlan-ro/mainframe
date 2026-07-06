/**
 * Persists which daemon the app was last connected to, so a restart reconnects
 * to it instead of always defaulting to the local sidecar.
 *
 * This is a GLOBAL pointer (which daemon), not daemon-scoped state, so it is a
 * plain key — NOT namespaced by daemon id like `mf:last-session`.
 */
const KEY = 'mf:last-daemon-id';

export function getLastDaemonId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; /* private mode / storage unavailable */
  }
}

export function setLastDaemonId(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode / storage unavailable — non-fatal */
  }
}
