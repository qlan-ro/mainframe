import React, { useEffect, useState } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import { useProjectsStore } from '../../store';
import { useChatsStore } from '../../store/chats';
import { useTabsStore } from '../../store/tabs';
import { daemonClient } from '../../lib/client';
import { getGitStatus, getSessionChanges } from '../../lib/api';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';

type Mode = 'branch' | 'session';

interface GitFile {
  status: string;
  path: string;
  oldPath?: string;
}

const statusLabels: Record<string, { label: string; color: string }> = {
  M: { label: 'Modified', color: 'text-mf-warning' },
  A: { label: 'Added', color: 'text-mf-success' },
  D: { label: 'Deleted', color: 'text-mf-destructive' },
  '?': { label: 'Untracked', color: 'text-mf-text-secondary' },
  R: { label: 'Renamed', color: 'text-mf-info' },
};

function splitPath(filePath: string): { name: string; dir: string } {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash === -1) return { name: filePath, dir: '' };
  return { name: filePath.slice(lastSlash + 1), dir: filePath.slice(0, lastSlash) };
}

export function ChangesTab(): React.ReactElement {
  const { activeProjectId } = useProjectsStore();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const { openDiffTab } = useTabsStore();
  const fileView = useTabsStore((s) => s.fileView);
  const [mode, setMode] = useState<Mode>('session');
  const [branchFiles, setBranchFiles] = useState<GitFile[]>([]);
  const [sessionFiles, setSessionFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshBranch = async (): Promise<void> => {
    if (!activeProjectId) return;
    setLoading(true);
    try {
      const result = await getGitStatus(activeProjectId, activeChatId ?? undefined);
      setBranchFiles(result.files);
    } catch {
      setBranchFiles([]);
    }
    setLoading(false);
  };

  const refreshSession = async (): Promise<void> => {
    if (!activeChatId) return;
    setLoading(true);
    try {
      const result = await getSessionChanges(activeChatId);
      setSessionFiles(result.files);
    } catch {
      setSessionFiles([]);
    }
    setLoading(false);
  };

  const refresh = mode === 'branch' ? refreshBranch : refreshSession;

  useEffect(() => {
    refreshBranch();
  }, [activeProjectId]);
  useEffect(() => {
    if (mode === 'session') refreshSession();
  }, [activeChatId, mode]);

  useEffect(() => {
    if (mode !== 'session' || !activeChatId) return;
    return daemonClient.onEvent((event) => {
      if (event.type === 'context.updated' && event.chatId === activeChatId) {
        refreshSession();
      }
    });
  }, [mode, activeChatId]);

  const files = mode === 'branch' ? branchFiles : sessionFiles;
  const fileCount = files.length;

  return (
    <div className="h-full flex flex-col">
      {/* Mode toggle */}
      <div className="flex items-center gap-0.5 mx-2 mt-1.5 p-0.5 rounded-md bg-mf-input">
        <button
          onClick={() => setMode('session')}
          className={cn(
            'flex-1 text-mf-small px-2 py-0.5 rounded transition-colors',
            mode === 'session'
              ? 'bg-mf-surface text-mf-text-primary shadow-sm'
              : 'text-mf-text-secondary hover:text-mf-text-primary',
          )}
        >
          Session
        </button>
        <button
          onClick={() => setMode('branch')}
          className={cn(
            'flex-1 text-mf-small px-2 py-0.5 rounded transition-colors',
            mode === 'branch'
              ? 'bg-mf-surface text-mf-text-primary shadow-sm'
              : 'text-mf-text-secondary hover:text-mf-text-primary',
          )}
        >
          Branch
        </button>
      </div>

      {/* Header row */}
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-mf-label text-mf-text-secondary">
          {mode === 'session' && !activeChatId
            ? 'No active session'
            : `${fileCount} changed file${fileCount !== 1 ? 's' : ''}`}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={refresh}
          disabled={loading || (mode === 'session' && !activeChatId)}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      {/* Session mode hint */}
      {mode === 'session' && activeChatId && (
        <p className="text-[11px] leading-tight text-mf-text-secondary opacity-60 px-2 pb-1">
          Files touched by this session. Diffs may include external changes. Use worktrees for full isolation.
        </p>
      )}

      {/* File list */}
      <ScrollArea className="flex-1">
        {mode === 'session' && !activeChatId ? (
          <div className="text-mf-small text-mf-text-secondary text-center py-4">
            Select a session to view its changes
          </div>
        ) : fileCount === 0 ? (
          <div className="text-mf-small text-mf-text-secondary text-center py-4">
            {mode === 'branch' ? 'No uncommitted changes' : 'No changes in this session'}
          </div>
        ) : mode === 'branch' ? (
          <div className="space-y-0.5 px-1">
            {(branchFiles as GitFile[]).map((file) => {
              const info = statusLabels[file.status] || { label: file.status, color: 'text-mf-text-secondary' };
              const { name, dir } = splitPath(file.path);
              const isActive =
                fileView?.type === 'diff' && fileView.source === 'git' && fileView.filePath === file.path;
              return (
                <button
                  key={file.path}
                  onClick={() => openDiffTab(file.path, 'git', undefined, file.oldPath)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1 rounded-mf-input text-left',
                    isActive ? 'bg-mf-hover' : 'hover:bg-mf-hover/50',
                  )}
                >
                  <FileText size={14} className="text-mf-text-secondary shrink-0" />
                  <span className="flex-1 min-w-0 truncate" title={file.path}>
                    <span className="text-mf-small text-mf-text-primary">{name}</span>
                    {dir && <span className="text-mf-small text-mf-text-secondary ml-1">{dir}</span>}
                  </span>
                  <span className={cn('text-mf-status font-medium shrink-0', info.color)}>{info.label}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-0.5 px-1">
            {(sessionFiles as string[]).map((filePath) => {
              const { name, dir } = splitPath(filePath);
              const isActive =
                fileView?.type === 'diff' && fileView.source === 'session' && fileView.filePath === filePath;
              return (
                <button
                  key={filePath}
                  onClick={() => openDiffTab(filePath, 'session', activeChatId!)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1 rounded-mf-input text-left',
                    isActive ? 'bg-mf-hover' : 'hover:bg-mf-hover/50',
                  )}
                >
                  <FileText size={14} className="text-mf-text-secondary shrink-0" />
                  <span className="flex-1 min-w-0 truncate" title={filePath}>
                    <span className="text-mf-small text-mf-text-primary">{name}</span>
                    {dir && <span className="text-mf-small text-mf-text-secondary ml-1">{dir}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
