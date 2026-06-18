/**
 * use-launch-configs — fetch and refresh launch configs + statuses.
 *
 * Takes the active {port, projectId, chatId} explicitly so it works both inside
 * the Run surface (context-derived) and in the shell MainToolbar (prop-derived).
 * Fetches both configs and the current process statuses in a single effect, and
 * exposes a `refetch` callback for manual refresh (e.g. on popover open).
 */
import { useEffect, useCallback, useState } from 'react';
import type { LaunchConfiguration } from '@qlan-ro/mainframe-types';
import { fetchLaunchConfigs, fetchLaunchStatuses, type LaunchStatusData } from '@/lib/api/launch';

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
        if (!cancelled) {
          setConfigs(cfgs);
          setStatusData(statuses);
        }
      })
      .catch((err) => console.warn('[launch] configs/statuses fetch failed', err));

    return () => {
      cancelled = true;
    };
  }, [port, projectId, chatId, tick]);

  return { configs, statusData, refetch };
}
