import React, { useEffect } from 'react';
import { useSandboxStore } from '../../store/sandbox';
import { useProjectsStore } from '../../store/projects';
import { startLaunchConfig, stopLaunchConfig } from '../../lib/launch';
import { useLaunchConfig } from '../../hooks/useLaunchConfig';
import type { LaunchConfiguration } from '@mainframe/types';

interface Props {
  onClose: () => void;
}

function processIcon(status: string, isFailed: boolean): React.ReactElement {
  if (status === 'starting') return <span className="text-yellow-400">⟳</span>;
  if (status === 'running') return <span className="text-mf-text-secondary">■</span>;
  if (isFailed) return <span className="text-red-400 opacity-60">▷</span>;
  return <span className="text-mf-text-secondary">▷</span>;
}

export function LaunchPopover({ onClose }: Props): React.ReactElement {
  const activeProject = useProjectsStore((s) =>
    s.activeProjectId ? (s.projects.find((p) => p.id === s.activeProjectId) ?? null) : null,
  );
  const launchConfig = useLaunchConfig();
  const processStatuses = useSandboxStore((s) => s.processStatuses);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-launch-popover]')) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleRowClick = async (config: LaunchConfiguration) => {
    if (!activeProject) return;
    const status = processStatuses[config.name] ?? 'stopped';
    if (status === 'starting') return;
    try {
      if (status === 'running') {
        await stopLaunchConfig(activeProject.id, config.name);
      } else {
        await startLaunchConfig(activeProject.id, config);
      }
    } catch (err) {
      console.warn('[sandbox] process toggle failed', err);
    }
  };

  const handleStopAll = async () => {
    if (!activeProject || !launchConfig) return;
    try {
      await Promise.all(launchConfig.configurations.map((c) => stopLaunchConfig(activeProject.id, c.name)));
    } catch (err) {
      console.warn('[sandbox] stop all failed', err);
    }
  };

  const configs = launchConfig?.configurations ?? [];
  const anyRunning = configs.some((c) => {
    const s = processStatuses[c.name] ?? 'stopped';
    return s === 'running' || s === 'starting';
  });

  return (
    <div
      data-launch-popover
      className="absolute right-0 bottom-7 w-52 bg-mf-panel-bg border border-mf-divider rounded shadow-lg z-50 py-1"
    >
      {configs.length === 0 ? (
        <div className="px-3 py-2 text-xs text-mf-text-secondary">No launch.json found.</div>
      ) : (
        <>
          {configs.map((c) => {
            const status = processStatuses[c.name] ?? 'stopped';
            return (
              <button
                key={c.name}
                onClick={() => void handleRowClick(c)}
                disabled={status === 'starting'}
                className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-mf-text-primary hover:bg-mf-hover disabled:opacity-50 disabled:cursor-default"
              >
                <span>{c.name}</span>
                {processIcon(status, status === 'failed')}
              </button>
            );
          })}
          <div className="border-t border-mf-divider my-1" />
          <button
            onClick={() => void handleStopAll()}
            disabled={!anyRunning}
            className="w-full text-left px-3 py-1.5 text-xs text-mf-text-secondary hover:bg-mf-hover disabled:opacity-40 disabled:cursor-default"
          >
            Stop all
          </button>
        </>
      )}
    </div>
  );
}
