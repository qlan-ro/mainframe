import { getActiveDaemon } from './active-daemon';

/**
 * Returns a localStorage key namespaced by the currently active daemon id.
 * Evaluated at call time so it always reflects the current active daemon,
 * even after a runtime daemon switch.
 */
export function daemonScopedKey(baseKey: string): string {
  return `${baseKey}::${getActiveDaemon().id}`;
}
