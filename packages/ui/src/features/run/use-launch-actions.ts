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
  const processStatuses = useSandboxStore((s) => s.processStatuses);
  const selectedConfigName = useSandboxStore((s) => s.selectedConfigName);
  const setSelectedConfigName = useSandboxStore((s) => s.setSelectedConfigName);
  const addRunTab = useLayoutStore((s) => s.addRunTab);

  const scopeKey =
    projectId && statusData?.effectivePath ? buildLaunchScope(projectId, statusData.effectivePath) : null;
  const scopeStatuses: Record<string, LaunchProcessStatus> = scopeKey ? (processStatuses[scopeKey] ?? {}) : {};

  // Pure selection — only updates the selected config. Does NOT open a preview
  // tab or start anything; that happens on start (handleLaunch).
  const handleSelect = useCallback(
    (config: LaunchConfiguration) => {
      if (!projectId) return;
      setSelectedConfigName(config.name);
    },
    [projectId, setSelectedConfigName],
  );

  const handleLaunch = useCallback(
    async (config: LaunchConfiguration) => {
      if (!projectId) return;
      setSelectedConfigName(config.name);
      // Every launch config opens (or focuses, via addRunTab's dedup) its own Run
      // tab: a `preview` config gets a webview tab, a process config gets a
      // full-space `console` tab. Distinct configs never share a tab. The tab
      // carries the launch scope so its console/status survive a later switch to
      // a chat that doesn't resolve to this scope.
      addRunTab(runTabForConfig(config, scopeKey));
      try {
        await startLaunchConfig(port, projectId, config.name, chatId ?? undefined);
      } catch (err) {
        mfToast.error(`Failed to start "${config.name}"`);
        console.warn('[launch] start failed', err);
      }
    },
    [port, projectId, chatId, scopeKey, addRunTab, setSelectedConfigName],
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
