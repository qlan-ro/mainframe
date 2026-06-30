/**
 * use-launch-actions — the shared launch behavior consumed by BOTH the Run
 * surface's `LaunchPopover` and the shell `ToolbarLaunchControls`.
 *
 * Wraps `useLaunchConfigs` (fetch) with the per-scope process statuses, the
 * selected-config state, and the start/stop handlers. Starting any config opens
 * (or focuses) its own Run tab — a `preview` webview tab for `preview:true`
 * configs, a full-space `console` tab for process configs. Selecting/starting a
 * config records it as the selected one so the toolbar picker reflects it.
 */
import { useCallback } from 'react';
import { mfToast } from '@/lib/toast';
import type { LaunchConfiguration, LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import { startLaunchConfig, stopLaunchConfig } from '@/lib/api/launch';
import { buildLaunchScope } from '@/lib/launch-scope';
import { useSandboxStore } from '@/store/sandbox';
import { useLayoutStore } from '@/store/layout';
import { useDaemonIsLocal } from '@/lib/daemon/use-daemon-is-local';
import { useLaunchConfigs } from './use-launch-configs';
import { runTabForConfig } from './run-tab-for-config';

export interface UseLaunchActionsResult {
  configs: LaunchConfiguration[];
  /** Status by config name for the active project/worktree scope. */
  scopeStatuses: Record<string, LaunchProcessStatus>;
  selectedConfigName: string | null;
  /** Select a config — updates the selected config only; no tab, no start. */
  handleSelect: (config: LaunchConfiguration) => void;
  handleLaunch: (config: LaunchConfiguration) => void;
  handleStop: (config: LaunchConfiguration) => void;
  refetch: () => void;
}

export function useLaunchActions(
  port: number,
  projectId: string | undefined,
  chatId: string | undefined,
): UseLaunchActionsResult {
  const { configs, statusData, refetch } = useLaunchConfigs(port, projectId, chatId);
  const isLocal = useDaemonIsLocal();
  const processStatuses = useSandboxStore((s) => s.processStatuses);
  const selectedConfigByScope = useSandboxStore((s) => s.selectedConfigByScope);
  const setSelectedConfig = useSandboxStore((s) => s.setSelectedConfig);
  const addRunTab = useLayoutStore((s) => s.addRunTab);

  const scopeKey =
    projectId && statusData?.effectivePath ? buildLaunchScope(projectId, statusData.effectivePath) : null;
  const scopeStatuses: Record<string, LaunchProcessStatus> = scopeKey ? (processStatuses[scopeKey] ?? {}) : {};

  // Effective selection: the active scope's stored config IF it still exists in
  // the current project's configs, else the first config. This guarantees the
  // picker always reflects the active project — a stale name from a previously
  // active project (or one that's since been removed) never sticks — and that a
  // real config is selected by default rather than a hard-coded placeholder.
  const storedName = scopeKey ? selectedConfigByScope[scopeKey] : undefined;
  const selectedConfig = configs.find((c) => c.name === storedName) ?? configs[0];
  const selectedConfigName = selectedConfig?.name ?? null;

  // Pure selection — only updates the selected config. Does NOT open a preview
  // tab or start anything; that happens on start (handleLaunch).
  const handleSelect = useCallback(
    (config: LaunchConfiguration) => {
      if (!scopeKey) return;
      setSelectedConfig(scopeKey, config.name);
    },
    [scopeKey, setSelectedConfig],
  );

  const handleLaunch = useCallback(
    async (config: LaunchConfiguration) => {
      if (!projectId) return;
      if (scopeKey) setSelectedConfig(scopeKey, config.name);
      // Every launch config opens (or focuses, via addRunTab's dedup) its own Run
      // tab: a `preview` config gets a webview tab, a process config gets a
      // full-space `console` tab. Distinct configs never share a tab. The tab
      // carries the launch scope so its console/status survive a later switch to
      // a chat that doesn't resolve to this scope.
      const tab = runTabForConfig(config, scopeKey, isLocal);
      if (tab) addRunTab(tab);
      try {
        await startLaunchConfig(port, projectId, config.name, chatId ?? undefined);
      } catch (err) {
        mfToast.error(`Failed to start "${config.name}"`);
        console.warn('[launch] start failed', err);
      }
    },
    [port, projectId, chatId, scopeKey, isLocal, addRunTab, setSelectedConfig],
  );

  const handleStop = useCallback(
    async (config: LaunchConfiguration) => {
      if (!projectId) return;
      try {
        await stopLaunchConfig(port, projectId, config.name, chatId ?? undefined);
      } catch (err) {
        mfToast.error(`Failed to stop "${config.name}"`);
        console.warn('[launch] stop failed', err);
      }
    },
    [port, projectId, chatId],
  );

  return { configs, scopeStatuses, selectedConfigName, handleSelect, handleLaunch, handleStop, refetch };
}
