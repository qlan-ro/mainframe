import React, { useCallback, useEffect, useState } from 'react';
import { Search, Play, Square, ChevronDown } from 'lucide-react';
import type { Layout } from 'react-resizable-panels';
import { useProjectsStore, useSearchStore } from '../store';
import { useUIStore } from '../store/ui';
import { useSandboxStore } from '../store/sandbox';
import { cn } from '../lib/utils';
import { LaunchPopover } from './sandbox/LaunchPopover';
import { StopPopover } from './sandbox/StopPopover';
import { useLaunchConfig } from '../hooks/useLaunchConfig';
import { startLaunchConfig } from '../lib/launch';
import { useActiveProjectId } from '../hooks/useActiveProjectId.js';
import { useChatsStore } from '../store/chats';

type PanelId = 'left' | 'right' | 'bottom';

interface TitleBarProps {
  panelSizes: Layout;
  panelCollapsed: Record<PanelId, boolean>;
}

export function TitleBar({
  panelSizes: _panelSizes,
  panelCollapsed: _panelCollapsed,
}: TitleBarProps): React.ReactElement {
  const { projects } = useProjectsStore();
  const activeProjectId = useActiveProjectId();
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const activeProjectName = activeProject?.name ?? 'Mainframe';
  const activeChat = useChatsStore((s) => s.chats.find((c) => c.id === s.activeChatId));
  const worktreeBranch = activeChat?.branchName;

  // Launch / Preview
  const [launchPopoverOpen, setLaunchPopoverOpen] = useState(false);
  const launchConfig = useLaunchConfig();
  const configs = launchConfig?.configurations ?? [];
  const togglePanel = useUIStore((s) => s.togglePanel);
  const setPanelVisible = useUIStore((s) => s.setPanelVisible);
  const panelCollapsed = useUIStore((s) => s.panelCollapsed);
  const projectStatuses =
    useSandboxStore((s) => (activeProjectId ? s.processStatuses[activeProjectId] : undefined)) ?? {};

  const selectedConfigName = useSandboxStore((s) => s.selectedConfigName);
  // Resolve selected config: explicit selection > preview flag > first config
  const selectedConfig =
    (selectedConfigName ? configs.find((c) => c.name === selectedConfigName) : null) ??
    configs.find((c) => c.preview) ??
    configs[0] ??
    null;
  const [stopPopoverOpen, setStopPopoverOpen] = useState(false);
  const runningCount = configs.filter((c) => {
    const s = projectStatuses[c.name] ?? 'stopped';
    return s === 'running' || s === 'starting';
  }).length;
  const anyRunning = runningCount > 0;

  // Auto-close stop popover when nothing is running
  useEffect(() => {
    if (!anyRunning) setStopPopoverOpen(false);
  }, [anyRunning]);

  const handleStart = useCallback(async () => {
    const projectId = activeProjectId;
    if (!projectId || !selectedConfig) return;
    try {
      const store = useSandboxStore.getState();
      store.clearLogsForName(selectedConfig.name);
      store.setLastStartedProcess(selectedConfig.name);
      await startLaunchConfig(projectId, selectedConfig.name);
      setPanelVisible(true);
      if (panelCollapsed.bottom) togglePanel('bottom');
    } catch (err) {
      console.warn('[sandbox] start failed', err);
    }
  }, [activeProjectId, selectedConfig, panelCollapsed, togglePanel, setPanelVisible]);

  const handleCloseLaunchPopover = useCallback(() => setLaunchPopoverOpen(false), []);
  const handleCloseStopPopover = useCallback(() => setStopPopoverOpen(false), []);

  return (
    <div className="h-11 bg-mf-app-bg flex items-center app-drag relative">
      {/* Traffic lights area + active project name */}
      <div className="flex items-center pl-[84px] pr-4 z-10 app-no-drag">
        <span className="text-mf-body font-medium text-mf-text-primary">
          {activeProjectName}
          {worktreeBranch && <span className="text-mf-text-secondary font-normal"> / {worktreeBranch}</span>}
        </span>
      </div>

      {/* Search box — centered in the title bar */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          onClick={() => useSearchStore.getState().open()}
          className="w-[480px] max-w-[90%] flex items-center gap-2 px-3 py-[5px] rounded-mf-card border border-mf-border text-mf-text-secondary text-mf-body app-no-drag cursor-pointer hover:border-mf-text-secondary transition-colors pointer-events-auto"
        >
          <Search size={14} />
          <span>Search ⌘F</span>
        </div>
      </div>

      {/* Right side — Preview + plugin icons */}
      <div className="absolute right-11 flex items-center gap-1 app-no-drag z-10">
        {/* Preview / Launch button */}
        <div className="relative flex items-center" data-launch-popover>
          <button
            data-testid="launch-config-selector"
            onClick={() => {
              setLaunchPopoverOpen((o) => !o);
              setStopPopoverOpen(false);
            }}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 text-mf-body rounded-mf-card hover:bg-mf-panel-bg transition-colors',
              selectedConfig
                ? 'text-mf-text-secondary hover:text-mf-text-primary'
                : 'text-mf-text-secondary opacity-60 hover:opacity-100',
            )}
            title="Launch configurations"
          >
            <span>{selectedConfig?.name ?? 'No launch configurations'}</span>
            <ChevronDown size={12} />
          </button>
          {launchPopoverOpen && <LaunchPopover onClose={handleCloseLaunchPopover} />}
        </div>

        {/* Play button — only when a config is selected and nothing is running */}
        {selectedConfig && !anyRunning && (
          <button
            data-testid="launch-start-btn"
            onClick={() => void handleStart()}
            className="w-7 h-7 flex items-center justify-center rounded-mf-card text-mf-accent hover:text-mf-accent hover:bg-mf-panel-bg transition-colors"
            title="Start"
          >
            <Play size={12} />
          </button>
        )}

        {/* Stop button with badge — when any process is running */}
        {anyRunning && (
          <div className="relative" data-stop-popover>
            <button
              data-testid="launch-stop-btn"
              onClick={() => {
                setStopPopoverOpen((o) => !o);
                setLaunchPopoverOpen(false);
              }}
              className="relative w-7 h-7 flex items-center justify-center rounded-mf-card hover:bg-mf-panel-bg transition-colors"
              title="Stop"
            >
              <Square size={12} className="text-red-400" />
              <span className="absolute bottom-0 right-0.5 text-[9px] font-bold leading-none text-mf-text-primary">
                {runningCount}
              </span>
            </button>
            {stopPopoverOpen && <StopPopover onClose={handleCloseStopPopover} />}
          </div>
        )}
      </div>
    </div>
  );
}
