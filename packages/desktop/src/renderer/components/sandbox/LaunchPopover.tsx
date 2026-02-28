import React, { useEffect } from 'react';
import { Play, Square, Plus } from 'lucide-react';
import { useSandboxStore } from '../../store/sandbox';
import { useProjectsStore } from '../../store/projects';
import { useChatsStore } from '../../store/chats';
import { useUIStore } from '../../store/ui';
import { startLaunchConfig, stopLaunchConfig } from '../../lib/launch';
import { useLaunchConfig } from '../../hooks/useLaunchConfig';
import { daemonClient } from '../../lib/client';
import type { LaunchConfiguration } from '@mainframe/types';
import { cn } from '../../lib/utils';

interface Props {
  onClose: () => void;
}

export function LaunchPopover({ onClose }: Props): React.ReactElement {
  const activeProject = useProjectsStore((s) =>
    s.activeProjectId ? (s.projects.find((p) => p.id === s.activeProjectId) ?? null) : null,
  );
  const launchConfig = useLaunchConfig();
  const projectStatuses =
    useSandboxStore((s) => (activeProject ? s.processStatuses[activeProject.id] : undefined)) ?? {};
  const selectedConfigName = useSandboxStore((s) => s.selectedConfigName);
  const setSelectedConfigName = useSandboxStore((s) => s.setSelectedConfigName);
  const togglePanel = useUIStore((s) => s.togglePanel);
  const setPanelVisible = useUIStore((s) => s.setPanelVisible);
  const panelCollapsed = useUIStore((s) => s.panelCollapsed);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-launch-popover]')) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleSelect = (name: string) => {
    setSelectedConfigName(name);
    onClose();
  };

  const clearLogsForName = useSandboxStore((s) => s.clearLogsForName);
  const markFreshLaunch = useSandboxStore((s) => s.markFreshLaunch);

  const handleToggleProcess = async (e: React.MouseEvent, config: LaunchConfiguration) => {
    e.stopPropagation();
    setSelectedConfigName(config.name);
    if (!activeProject) return;
    const status = projectStatuses[config.name] ?? 'stopped';
    if (status === 'starting') return;
    try {
      if (status === 'running') {
        await stopLaunchConfig(activeProject.id, config.name);
      } else {
        clearLogsForName(config.name);
        markFreshLaunch(config.name);
        await startLaunchConfig(activeProject.id, config.name);
        setPanelVisible(true);
        if (panelCollapsed.bottom) togglePanel('bottom');
      }
    } catch (err) {
      console.warn('[sandbox] process toggle failed', err);
    }
  };

  const configs = launchConfig?.configurations ?? [];

  return (
    <div
      data-launch-popover
      data-testid="launch-popover"
      className="absolute right-0 top-full mt-1 w-56 bg-mf-panel-bg border border-mf-divider rounded shadow-lg z-50 py-1"
    >
      {configs.length > 0 && (
        <>
          {configs.map((c) => {
            const status = projectStatuses[c.name] ?? 'stopped';
            const isSelected = c.name === selectedConfigName;
            const isRunning = status === 'running' || status === 'starting';

            return (
              <div
                key={c.name}
                data-testid={`launch-config-${c.name}`}
                onClick={() => handleSelect(c.name)}
                className={cn(
                  'flex items-center justify-between px-3 py-1.5 text-xs cursor-pointer transition-colors',
                  isSelected
                    ? 'text-mf-text-primary bg-mf-hover'
                    : 'text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover',
                )}
              >
                <span>{c.name}</span>
                <button
                  onClick={(e) => void handleToggleProcess(e, c)}
                  disabled={status === 'starting'}
                  className={cn(
                    'w-5 h-5 flex items-center justify-center rounded transition-colors disabled:opacity-40',
                    isRunning ? 'text-red-400 hover:text-red-300' : 'text-mf-accent hover:text-mf-accent',
                  )}
                  title={isRunning ? 'Stop' : 'Start'}
                >
                  {isRunning ? <Square size={10} /> : <Play size={10} />}
                </button>
              </div>
            );
          })}
        </>
      )}
      {configs.length > 0 && <div className="border-t border-mf-divider my-1" />}
      <button
        onClick={() => {
          if (!activeProject) return;
          const chatId = useChatsStore.getState().activeChatId;
          if (chatId) {
            daemonClient.sendMessage(chatId, '/launch-config');
          } else {
            daemonClient.createChat(activeProject.id, 'claude');
            // Chat creation is async; wait for it to appear, then send
            const unsub = useChatsStore.subscribe((state) => {
              if (state.activeChatId) {
                daemonClient.sendMessage(state.activeChatId, '/launch-config');
                unsub();
              }
            });
          }
          onClose();
        }}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors"
      >
        <Plus size={12} />
        <span>Add configuration</span>
      </button>
    </div>
  );
}
