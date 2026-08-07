/**
 * launch-view — the Launch section's rows: every launch configuration in the
 * project, with its live process state and whether it is the one the rail's
 * quick action would act on.
 *
 * The row carries the whole `LaunchConfiguration` because `handleLaunch` /
 * `handleStop` take the object, not a name, and keeps the raw `status` so the
 * section can still spin on `starting` — `live` alone would flatten that into
 * `running`.
 */
import type { LaunchConfiguration, LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import { isLaunchStatusLive } from '@/features/run/derive-launch-control';

export interface LaunchRow {
  config: LaunchConfiguration;
  name: string;
  status: LaunchProcessStatus;
  live: boolean;
  selected: boolean;
}

export function deriveLaunchRows(
  configs: readonly LaunchConfiguration[],
  scopeStatuses: Record<string, LaunchProcessStatus>,
  selectedConfigName: string | null,
): LaunchRow[] {
  return configs.map((config) => {
    const status = scopeStatuses[config.name] ?? 'stopped';
    return {
      config,
      name: config.name,
      status,
      live: isLaunchStatusLive(status),
      selected: config.name === selectedConfigName,
    };
  });
}
