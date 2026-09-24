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
import { isLaunchStatusLive, NO_CONFIGS_LABEL } from '@/features/run/derive-launch-control';

/** A non-project chat has nothing to launch against — say so, not "no configs" (todo #346). */
export const NO_PROJECT_LAUNCH_LABEL = 'Launch isn’t available for a chat with no project.';

/** The Launch section's empty-row copy: distinguishes "no project" from "project has no configs". */
export function launchEmptyStateLabel(noProject: boolean): string {
  return noProject ? NO_PROJECT_LAUNCH_LABEL : NO_CONFIGS_LABEL;
}

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
