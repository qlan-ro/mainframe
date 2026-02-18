import React, { useState, useEffect, useRef } from 'react';
import { GitBranch } from 'lucide-react';
import { useChatsStore } from '../store';
import { useProjectsStore } from '../store/projects';
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

  useEffect(() => {
    if (!activeProjectId) {
      setGitBranch(null);
      return;
    }

    const fetchBranch = () => {
      getGitBranch(activeProjectId, activeChatId ?? undefined)
        .then((res) => setGitBranch(res.branch))
        .catch((err) => {
          console.warn('[status-bar] git branch fetch failed:', err);
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
    <div className="h-6 bg-mf-app-bg px-[10px] flex items-center text-mf-body">
      <div className="flex items-center gap-4">
        {/* Connection status */}
        <div className="flex items-center gap-[6px] text-mf-text-secondary">
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
    </div>
  );
}
