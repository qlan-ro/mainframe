import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GitBranch } from 'lucide-react';
import { createLogger } from '../lib/logger';

const log = createLogger('renderer:statusbar');
import { useChatsStore } from '../store';
import { useProjectsStore } from '../store/projects';
import { useUIStore } from '../store/ui';
import { useConnectionState } from '../hooks/useConnectionState';
import { getGitBranch } from '../lib/api';
import { cn } from '../lib/utils';
import { LaunchPopover } from './sandbox/LaunchPopover';
import { useLaunchConfig } from '../hooks/useLaunchConfig';
import { useSandboxStore } from '../store/sandbox';
import { startLaunchConfig, stopLaunchConfig } from '../lib/launch';

const GIT_POLL_INTERVAL = 15_000;

export function StatusBar(): React.ReactElement {
  const connected = useConnectionState();
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const chats = useChatsStore((s) => s.chats);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const togglePanel = useUIStore((s) => s.togglePanel);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!activeProjectId) {
      setGitBranch(null);
      return;
    }

    const fetchBranch = () => {
      getGitBranch(activeProjectId, activeChatId ?? undefined)
        .then((res) => setGitBranch(res.branch))
        .catch((err) => {
          log.warn('git branch fetch failed', { err: String(err) });
          setGitBranch(null);
        });
    };

    fetchBranch();
    pollRef.current = setInterval(fetchBranch, GIT_POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeProjectId, activeChatId]);

  const counts = { idle: 0, working: 0, waiting: 0 };
  for (const chat of chats) {
    counts[chat.displayStatus ?? 'idle']++;
  }

  const [popoverOpen, setPopoverOpen] = useState(false);
  const launchConfig = useLaunchConfig();
  const processStatuses = useSandboxStore((s) => s.processStatuses);
  const panelCollapsed = useUIStore((s) => s.panelCollapsed);

  const aggregateIcon = (() => {
    const statuses = (launchConfig?.configurations ?? []).map((c) => processStatuses[c.name] ?? 'stopped');
    if (statuses.some((s) => s === 'starting')) return '⟳';
    if (statuses.some((s) => s === 'running')) return '■';
    return '▷';
  })();

  const previewConfig = launchConfig?.configurations.find((c) => c.preview) ?? null;

  const handlePreviewClick = useCallback(async () => {
    // Read activeProjectId directly from store to avoid adding it as a dep
    const projectId = useProjectsStore.getState().activeProjectId;
    if (!projectId || !previewConfig) {
      togglePanel('bottom');
      return;
    }
    const status = processStatuses[previewConfig.name] ?? 'stopped';
    try {
      if (status === 'running' || status === 'starting') {
        await stopLaunchConfig(projectId, previewConfig.name);
      } else {
        await startLaunchConfig(projectId, previewConfig);
        if (panelCollapsed.bottom) togglePanel('bottom');
      }
    } catch (err) {
      console.warn('[sandbox] preview toggle failed', err);
    }
  }, [previewConfig, processStatuses, panelCollapsed, togglePanel]);

  const handleClosePopover = useCallback(() => setPopoverOpen(false), []);

  return (
    <div className="h-6 bg-mf-app-bg px-[10px] flex items-center justify-between text-mf-body">
      <div className="flex items-center gap-4">
        {/* Connection status */}
        <div data-testid="connection-status" className="flex items-center gap-[6px] text-mf-text-secondary">
          <div className={cn('w-[6px] h-[6px] rounded-full', connected ? 'bg-mf-success' : 'bg-mf-destructive')} />
          <span>{connected ? 'Connected' : 'Disconnected'}</span>
        </div>

        {/* Git branch */}
        {gitBranch && (
          <div className="flex items-center gap-1 text-mf-text-secondary">
            <GitBranch size={14} />
            <span>{gitBranch}</span>
          </div>
        )}

        {/* Session metrics */}
        {chats.length > 0 && (
          <div className="flex items-center gap-2 text-mf-text-secondary">
            {counts.working > 0 && <span>{counts.working} Working</span>}
            {counts.waiting > 0 && <span className="text-mf-warning">{counts.waiting} Needs Input</span>}
            <span>{counts.idle} Idle</span>
          </div>
        )}
      </div>

      {/* Right side actions */}
      <div className="flex items-center">
        <div className="relative flex items-center">
          <button
            onClick={() => void handlePreviewClick()}
            className="text-xs text-mf-text-secondary hover:text-mf-text-primary px-2 py-0.5 rounded-l border-r border-mf-divider"
            title="Start/stop preview"
          >
            {aggregateIcon} Preview
          </button>
          <button
            onClick={() => setPopoverOpen((o) => !o)}
            className="text-xs text-mf-text-secondary hover:text-mf-text-primary px-1.5 py-0.5 rounded-r"
            title="Launch configurations"
          >
            ∨
          </button>
          {popoverOpen && <LaunchPopover onClose={handleClosePopover} />}
        </div>
      </div>
    </div>
  );
}
