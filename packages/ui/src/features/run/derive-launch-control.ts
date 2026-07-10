/**
 * deriveLaunchRunControl — pure state derivation for the toolbar run/stop button
 * (`main-toolbar-play`).
 *
 * The button reflects the ACTUAL running state of the launch scope, not just the
 * selected config. A config can enter `running`/`starting` without being the
 * selected one — reconciled on boot, started from the Run-surface add-menu, or
 * left running after the user re-selected a different row. Deriving `running`
 * from the selection alone (the pre-#206 bug) left the button a green Play in
 * those cases: no Stop to reach the live process, and a second green ▶ sitting
 * beside the Run-surface rail glyph (the reported "doubled icon").
 *
 * Rule: target the selected config (falling back to the first) for a start; if
 * that target — or, failing that, any config in the scope — is live, switch to a
 * stop that targets the live one. The label follows the target so the chip, the
 * button, and its action always agree.
 */
import type { LaunchConfiguration, LaunchProcessStatus } from '@qlan-ro/mainframe-types';

export type LaunchRunMode = 'empty' | 'idle' | 'running';

export interface LaunchRunControl {
  mode: LaunchRunMode;
  /** The config the button acts on: started when `idle`, stopped when `running`. */
  target?: LaunchConfiguration;
  /** Chip label — the target's name, or the placeholder when there are no configs. */
  label: string;
}

export const NO_CONFIGS_LABEL = 'No Launch Configurations';

const LIVE_STATUSES: ReadonlySet<LaunchProcessStatus> = new Set<LaunchProcessStatus>(['running', 'starting']);

export function deriveLaunchRunControl(
  configs: LaunchConfiguration[],
  scopeStatuses: Record<string, LaunchProcessStatus>,
  selectedConfigName: string | null,
): LaunchRunControl {
  const startTarget =
    (selectedConfigName ? configs.find((c) => c.name === selectedConfigName) : undefined) ?? configs[0];
  if (!startTarget) return { mode: 'empty', label: NO_CONFIGS_LABEL };

  const isLive = (name: string) => LIVE_STATUSES.has(scopeStatuses[name] ?? 'stopped');
  const runningTarget = isLive(startTarget.name) ? startTarget : configs.find((c) => isLive(c.name));

  if (runningTarget) return { mode: 'running', target: runningTarget, label: runningTarget.name };
  return { mode: 'idle', target: startTarget, label: startTarget.name };
}
