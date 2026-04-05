import React, { useEffect } from 'react';
import { Play, Square, Sparkles } from 'lucide-react';
import { useSandboxStore } from '../../store/sandbox';
import { useProjectsStore } from '../../store/projects';
import { useActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { useChatsStore } from '../../store/chats';
import { useUIStore } from '../../store/ui';
import { startLaunchConfig, stopLaunchConfig } from '../../lib/launch';
import { useLaunchConfig } from '../../hooks/useLaunchConfig';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { useLaunchScopeKey } from '../../hooks/useLaunchScopeKey.js';
import { daemonClient } from '../../lib/client';
import { getDefaultModelForAdapter } from '../../lib/adapters';
import type { LaunchConfiguration } from '@qlan-ro/mainframe-types';
import { cn } from '../../lib/utils';

interface Props {
  onClose: () => void;
}

export function LaunchPopover({ onClose }: Props): React.ReactElement {
  const activeProjectId = useActiveProjectId();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const activeProject = useProjectsStore((s) =>
    activeProjectId ? (s.projects.find((p) => p.id === activeProjectId) ?? null) : null,
  );
  const launchConfig = useLaunchConfig();
  const scopeKey = useLaunchScopeKey();
  const scopeStatuses = useSandboxStore((s) => (scopeKey ? s.processStatuses[scopeKey] : undefined)) ?? {};
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

  const clearLogsForProcess = useSandboxStore((s) => s.clearLogsForProcess);
  const setLastStartedProcess = useSandboxStore((s) => s.setLastStartedProcess);

  const handleToggleProcess = async (e: React.MouseEvent, config: LaunchConfiguration) => {
    e.stopPropagation();
    setSelectedConfigName(config.name);
    if (!activeProject) return;
    const status = scopeStatuses[config.name] ?? 'stopped';
    if (status === 'starting') return;
    try {
      if (status === 'running') {
        await stopLaunchConfig(activeProject.id, config.name, activeChatId ?? undefined);
      } else {
        if (scopeKey) clearLogsForProcess(scopeKey, config.name);
        setLastStartedProcess(config.name);
        await startLaunchConfig(activeProject.id, config.name, activeChatId ?? undefined);
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
            const status = scopeStatuses[c.name] ?? 'stopped';
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={(e) => void handleToggleProcess(e, c)}
                      disabled={status === 'starting'}
                      className={cn(
                        'w-5 h-5 flex items-center justify-center rounded transition-colors disabled:opacity-40',
                        isRunning ? 'text-red-400 hover:text-red-300' : 'text-mf-accent hover:text-mf-accent',
                      )}
                    >
                      {isRunning ? <Square size={10} /> : <Play size={10} />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{isRunning ? 'Stop' : 'Start'}</TooltipContent>
                </Tooltip>
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
            daemonClient.createChat(activeProject.id, 'claude', getDefaultModelForAdapter('claude'));
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
        <Sparkles size={12} />
        <span>Generate with Agent</span>
      </button>
    </div>
  );
}
