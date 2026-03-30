import React, { useEffect, useMemo } from 'react';
import { Square } from 'lucide-react';
import { useSandboxStore } from '../../store/sandbox';
import { useActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { useChatsStore } from '../../store/chats';
import { stopLaunchConfig } from '../../lib/launch';
import { useLaunchConfig } from '../../hooks/useLaunchConfig';
import { useLaunchScopeKey } from '../../hooks/useLaunchScopeKey.js';

interface Props {
  onClose: () => void;
}

export function StopPopover({ onClose }: Props): React.ReactElement {
  const activeProjectId = useActiveProjectId();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const launchConfig = useLaunchConfig();
  const scopeKey = useLaunchScopeKey();
  const scopeStatuses = useSandboxStore((s) => (scopeKey ? s.processStatuses[scopeKey] : undefined)) ?? {};

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-stop-popover]')) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const configs = launchConfig?.configurations ?? [];
  const runningConfigs = useMemo(
    () =>
      configs.filter((c) => {
        const s = scopeStatuses[c.name] ?? 'stopped';
        return s === 'running' || s === 'starting';
      }),
    [configs, scopeStatuses],
  );

  const handleStop = async (name: string) => {
    if (!activeProjectId) return;
    try {
      await stopLaunchConfig(activeProjectId, name, activeChatId ?? undefined);
    } catch (err) {
      console.warn('[sandbox] stop failed', err);
    }
  };

  const handleStopAll = async () => {
    if (!activeProjectId) return;
    try {
      await Promise.all(
        runningConfigs.map((c) => stopLaunchConfig(activeProjectId, c.name, activeChatId ?? undefined)),
      );
    } catch (err) {
      console.warn('[sandbox] stop all failed', err);
    }
    onClose();
  };

  return (
    <div
      data-stop-popover
      className="absolute right-0 top-full mt-1 w-56 bg-mf-panel-bg border border-mf-divider rounded shadow-lg z-50 py-1"
    >
      {runningConfigs.map((c) => (
        <button
          key={c.name}
          onClick={() => void handleStop(c.name)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors"
        >
          <Square size={10} className="text-red-400 shrink-0" />
          <span>Stop &apos;{c.name}&apos;</span>
        </button>
      ))}
      <div className="border-t border-mf-divider my-1" />
      <button
        onClick={() => void handleStopAll()}
        className="w-full text-left px-3 py-1.5 text-xs text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors"
      >
        Stop All
      </button>
    </div>
  );
}
