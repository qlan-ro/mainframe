/**
 * use-launch-actions — the shared launch behavior consumed by BOTH the Run
 * surface's `LaunchPopover` and the shell `ToolbarLaunchControls`.
 *
 * Wraps `useLaunchConfigs` (fetch) with the per-scope process statuses, the
 * selected-config state, and the start/stop handlers. Starting a `preview:true`
 * config also opens a `kind:'preview'` Run tab. Selecting/starting a config
 * records it as the selected one so the toolbar picker reflects it.
 */
import { useCallback } from 'react';
import { toast } from 'sonner';
import type { LaunchConfiguration, LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import { startLaunchConfig, stopLaunchConfig } from '@/lib/api/launch';
import { buildLaunchScope } from '@/lib/launch-scope';
import { useSandboxStore } from '@/store/sandbox';
import { useLayoutStore } from '@/store/layout';
import { useLaunchConfigs } from './use-launch-configs';

export interface UseLaunchActionsResult {
  configs: LaunchConfiguration[];
  /** Status by config name for the active project/worktree scope. */
  scopeStatuses: Record<string, LaunchProcessStatus>;
  selectedConfigName: string | null;
  /** Select a config (and open/focus its preview tab) without starting it. */
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
  const scopeStatuses: Record<string, LaunchProcessStatus> = scopeKey
    ? (processStatuses[scopeKey] ?? {})
    : {};

  const handleSelect = useCallback(
    (config: LaunchConfiguration) => {
      if (!projectId) return;
      setSelectedConfigName(config.name);
      // Preview configs open (or focus, via addRunTab's dedup) their Run tab on select.
      if (config.preview) {
        const tabId = `preview-${config.name}-${crypto.randomUUID().slice(0, 8)}`;
        addRunTab({ id: tabId, kind: 'preview', title: config.name, config: config.name });
      }
    },
    [projectId, addRunTab, setSelectedConfigName],
  );

  const handleLaunch = useCallback(
    async (config: LaunchConfiguration) => {
      if (!projectId) return;
      handleSelect(config);
      try {
        await startLaunchConfig(port, projectId, config.name, chatId ?? undefined);
      } catch (err) {
        toast.error(`Failed to start "${config.name}"`);
        console.warn('[launch] start failed', err);
      }
    },
    [port, projectId, chatId, handleSelect],
  );

  const handleStop = useCallback(
    async (config: LaunchConfiguration) => {
      if (!projectId) return;
      try {
        await stopLaunchConfig(port, projectId, config.name, chatId ?? undefined);
      } catch (err) {
        toast.error(`Failed to stop "${config.name}"`);
        console.warn('[launch] stop failed', err);
      }
    },
    [port, projectId, chatId],
  );

  return { configs, scopeStatuses, selectedConfigName, handleSelect, handleLaunch, handleStop, refetch };
}
