/**
 * On first app load, reconnect to the daemon the user was last on (persisted via
 * setLastDaemonId on every switch). No-op when the last daemon is local, already
 * active, or not (yet) in the registry. The switch reuses the normal path
 * (registry.switchTo → keyed remount + reconnect); an unreachable remote surfaces
 * the usual unreachable overlay + switch-to-local.
 */
import { useEffect } from 'react';
import { getLastDaemonId } from '@/lib/daemon/last-daemon';
import type { UseDaemonRegistryResult } from './use-daemon-registry';

// Module-level: restore is attempted at most ONCE per app load. The consumer
// (footer) REMOUNTS on a daemon switch, so a component-scoped ref would reset
// and re-trigger the restore against the just-restored daemon.
let restoreAttempted = false;

/** Test-only: reset the process-lived guard between cases. */
export function __resetRestoreGuardForTests(): void {
  restoreAttempted = false;
}

export function useRestoreLastDaemon(registry: UseDaemonRegistryResult): void {
  const { daemons, activeId, switchTo } = registry;
  useEffect(() => {
    if (restoreAttempted) return;
    const lastId = getLastDaemonId();
    if (lastId === null || lastId === 'local') {
      restoreAttempted = true;
      return;
    }
    // The registry loads its remote list asynchronously — wait until the saved
    // daemon appears (this effect re-runs as `daemons` fills in). If it never
    // appears (removed), we simply never restore.
    if (!daemons.some((d) => d.id === lastId)) return;
    restoreAttempted = true;
    if (activeId !== lastId) void switchTo(lastId);
  }, [daemons, activeId, switchTo]);
}
