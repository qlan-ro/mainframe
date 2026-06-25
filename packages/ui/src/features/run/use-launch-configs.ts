/**
 * use-launch-configs — fetch and refresh launch configs + statuses.
 *
 * Takes the active {port, projectId, chatId} explicitly so it works both inside
 * the Run surface (context-derived) and in the shell MainToolbar (prop-derived).
 * Fetches both configs and the current process statuses in a single effect, and
 * exposes a `refetch` callback for manual refresh (e.g. on popover open).
 */
import { useEffect, useCallback, useState } from 'react';
import type { LaunchConfiguration, LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import { fetchLaunchConfigs, fetchLaunchStatuses, type LaunchStatusData } from '@/lib/api/launch';
import { useSandboxStore } from '@/store/sandbox';
import { useLayoutStore } from '@/store/layout';
import { buildLaunchScope } from '@/lib/launch-scope';
import { runTabForConfig } from './run-tab-for-config';

export interface UseLaunchConfigsResult {
  configs: LaunchConfiguration[];
  statusData: LaunchStatusData | null;
  refetch: () => void;
}

export function useLaunchConfigs(
  port: number,
  projectId: string | undefined,
  chatId: string | undefined,
): UseLaunchConfigsResult {
  const [configs, setConfigs] = useState<LaunchConfiguration[]>([]);
  const [statusData, setStatusData] = useState<LaunchStatusData | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    Promise.all([
      fetchLaunchConfigs(port, projectId, chatId ?? undefined),
      fetchLaunchStatuses(port, projectId, chatId ?? undefined),
    ])
      .then(([cfgs, statuses]) => {
        if (cancelled) return;
        setConfigs(cfgs);
        setStatusData(statuses);
        // Seed the shared sandbox store from the fetched statuses so an
        // already-running process is reflected in the preview tab + toolbar.
        // WS `launch.status` events only fire on CHANGE, so a process already
        // running before this client subscribed would otherwise never appear.
        const setProcessStatus = useSandboxStore.getState().setProcessStatus;
        const scope = buildLaunchScope(projectId, statuses.effectivePath);
        // Run tabs already open, keyed by their config name (don't re-add/re-focus).
        const layout = useLayoutStore.getState();
        const tabbed = new Set(
          (layout.run?.panes ?? []).flatMap((p) => p.tabs.map((t) => t.config).filter((c): c is string => Boolean(c))),
        );
        for (const [name, status] of Object.entries(statuses.statuses)) {
          setProcessStatus(scope, name, status as LaunchProcessStatus);
          // A running/starting config must always have a tab in the Run surface —
          // reconcile one if missing (e.g. after an app restart, where the run
          // panes are empty but the process is still alive).
          if ((status === 'running' || status === 'starting') && !tabbed.has(name)) {
            const cfg = cfgs.find((c) => c.name === name);
            if (cfg) {
              layout.addRunTab(runTabForConfig(cfg, scope));
              tabbed.add(name);
            }
          }
        }
      })
      .catch((err) => console.warn('[launch] configs/statuses fetch failed', err));

    return () => {
      cancelled = true;
    };
  }, [port, projectId, chatId, tick]);

  return { configs, statusData, refetch };
}
