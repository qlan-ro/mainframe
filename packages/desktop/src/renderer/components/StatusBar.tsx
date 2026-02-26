import React, { useEffect, useRef, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { createLogger } from '../lib/logger';

const log = createLogger('renderer:statusbar');
import { useChatsStore } from '../store';
import { useProjectsStore } from '../store/projects';
import { useUIStore } from '../store';
import { useConnectionState } from '../hooks/useConnectionState';
import { getGitBranch } from '../lib/api';
import { cn } from '../lib/utils';

const GIT_POLL_INTERVAL = 15_000;

export function StatusBar(): React.ReactElement {
  const connected = useConnectionState();
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const chats = useChatsStore((s) => s.chats);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const panelVisible = useUIStore((s) => s.panelVisible);
  const setPanelVisible = useUIStore((s) => s.setPanelVisible);

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

      {/* Logs panel toggle */}
      <div className="flex items-center gap-1 text-xs text-mf-text-secondary">
        {/* Pipe divider */}
        <div className="text-mf-divider">|</div>

        {/* Toggle logs panel button */}
        <button
          onClick={() => setPanelVisible(!panelVisible)}
          className={[
            'px-2 py-1 rounded hover:text-mf-text-primary transition-colors',
            panelVisible ? 'text-mf-text-primary' : 'text-mf-text-secondary',
          ].join(' ')}
          title="Toggle logs panel"
        >
          Logs
        </button>
      </div>
    </div>
  );
}
