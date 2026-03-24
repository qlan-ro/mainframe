import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, GitBranch } from 'lucide-react';
import { createLogger } from '../lib/logger';

const log = createLogger('renderer:statusbar');
import { useChatsStore } from '../store';
import { useProjectsStore } from '../store/projects';
import { useConnectionState } from '../hooks/useConnectionState';
import { getGitBranch, getGitStatus } from '../lib/api';
import { cn } from '../lib/utils';
import { BranchPopover } from './git/BranchPopover';

const GIT_POLL_INTERVAL = 60_000;

export function StatusBar(): React.ReactElement {
  const connected = useConnectionState();
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const chats = useChatsStore((s) => s.chats);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [hasConflicts, setHasConflicts] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchBranchAndStatus = useCallback(() => {
    if (!activeProjectId) {
      setGitBranch(null);
      setHasConflicts(false);
      return;
    }
    getGitBranch(activeProjectId, activeChatId ?? undefined)
      .then((res) => setGitBranch(res.branch))
      .catch((err) => {
        log.warn('git branch fetch failed', { err: String(err) });
        setGitBranch(null);
      });
    getGitStatus(activeProjectId)
      .then((res) => {
        const conflicts = res.files.some((f) => f.status === 'U' || f.status === 'UU');
        setHasConflicts(conflicts);
      })
      .catch((err) => {
        console.warn('[StatusBar] git status fetch failed', err);
        setHasConflicts(false);
      });
  }, [activeProjectId, activeChatId]);

  useEffect(() => {
    fetchBranchAndStatus();
    pollRef.current = setInterval(fetchBranchAndStatus, GIT_POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchBranchAndStatus]);

  const handleBranchChanged = useCallback(() => {
    fetchBranchAndStatus();
  }, [fetchBranchAndStatus]);

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

        {/* Git branch — clickable */}
        {gitBranch && (
          <div className="relative">
            <button
              data-testid="branch-button"
              onClick={() => {
                if (!popoverOpen) fetchBranchAndStatus();
                setPopoverOpen(!popoverOpen);
              }}
              className={cn(
                'flex items-center gap-1 text-mf-text-secondary hover:text-mf-text-primary transition-colors',
                popoverOpen && 'text-mf-text-primary',
              )}
            >
              {hasConflicts && <AlertTriangle size={12} className="text-mf-warning" />}
              <GitBranch size={14} />
              <span>{gitBranch}</span>
            </button>

            {popoverOpen && activeProjectId && (
              <div className="absolute bottom-full left-0 mb-1 z-50">
                <BranchPopover
                  projectId={activeProjectId}
                  onBranchChanged={handleBranchChanged}
                  onClose={() => setPopoverOpen(false)}
                />
              </div>
            )}
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
