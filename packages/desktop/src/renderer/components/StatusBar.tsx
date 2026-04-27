import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownCircle, Download, FolderGit, GitBranch, RotateCcw } from 'lucide-react';
import { createLogger } from '../lib/logger';

const log = createLogger('renderer:statusbar');
import { useChatsStore } from '../store';
import { useActiveProjectId } from '../hooks/useActiveProjectId.js';
import { useConnectionState } from '../hooks/useConnectionState';
import { useUpdateStatus } from '../hooks/useUpdateStatus.js';
import { getGitBranch, getGitStatus } from '../lib/api';
import { isConflictStatus } from '../lib/git-utils';
import { cn } from '../lib/utils';
import { BranchPopover } from './git/BranchPopover';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

const GIT_POLL_INTERVAL = 60_000;

function UpdateIndicator(): React.ReactElement | null {
  const status = useUpdateStatus();

  if (!status || status.state === 'not-available' || status.state === 'checking') {
    return null;
  }

  if (status.state === 'available') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="flex items-center gap-1 text-mf-accent hover:text-mf-text-primary transition-colors"
            onClick={() => {
              try {
                window.mainframe.updates.download();
              } catch (err) {
                console.warn('[UpdateIndicator] download failed', err);
              }
            }}
          >
            <Download size={12} />
            <span>Update v{status.version}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Download update v{status.version}</TooltipContent>
      </Tooltip>
    );
  }

  if (status.state === 'downloading') {
    return (
      <span className="flex items-center gap-1 text-mf-text-secondary">
        <ArrowDownCircle size={12} />
        <span>Downloading… {status.percent}%</span>
      </span>
    );
  }

  if (status.state === 'downloaded') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="flex items-center gap-1 text-mf-success hover:text-mf-text-primary transition-colors"
            onClick={() => {
              try {
                window.mainframe.updates.install();
              } catch (err) {
                console.warn('[UpdateIndicator] install failed', err);
              }
            }}
          >
            <RotateCcw size={12} />
            <span>Restart to update</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Restart to install v{status.version}</TooltipContent>
      </Tooltip>
    );
  }

  if (status.state === 'error') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1 text-mf-destructive cursor-default">
            <AlertTriangle size={12} />
            <span>Update error</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm whitespace-pre-wrap break-words">
          {status.message}
        </TooltipContent>
      </Tooltip>
    );
  }

  return null;
}

export function StatusBar(): React.ReactElement {
  const connected = useConnectionState();
  const activeProjectId = useActiveProjectId();
  const chats = useChatsStore((s) => s.chats);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const inWorktree = useChatsStore((s) => !!s.chats.find((c) => c.id === s.activeChatId)?.worktreePath);
  const worktreeMissing = useChatsStore((s) => !!s.chats.find((c) => c.id === s.activeChatId)?.worktreeMissing);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [hasConflicts, setHasConflicts] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchBranchAndStatus = useCallback(() => {
    if (!activeProjectId || worktreeMissing) {
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
    getGitStatus(activeProjectId, activeChatId ?? undefined)
      .then((res) => {
        const conflicts = res.files.some((f) => isConflictStatus(f.status));
        setHasConflicts(conflicts);
      })
      .catch((err) => {
        console.warn('[StatusBar] git status fetch failed', err);
        setHasConflicts(false);
      });
  }, [activeProjectId, activeChatId, worktreeMissing]);

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
              onMouseDown={(e) => e.stopPropagation()}
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
              {inWorktree ? <FolderGit size={14} className="text-mf-accent" /> : <GitBranch size={14} />}
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

      {/* Right side — update indicator */}
      <div className="flex items-center gap-2 text-mf-body">
        <UpdateIndicator />
      </div>
    </div>
  );
}
