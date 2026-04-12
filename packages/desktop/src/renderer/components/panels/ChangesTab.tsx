import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import { useActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { useChatsStore } from '../../store/chats';
import { useTabsStore } from '../../store/tabs';
import { daemonClient } from '../../lib/client';
import { getSessionDiffs, getBranchDiffs } from '../../lib/api';
import type { BranchDiffResponse } from '../../lib/api';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { useZoneHeaderTabs } from '../zone/ZoneHeaderSlot.js';

type Mode = 'branch' | 'session';

const statusLabels: Record<string, { label: string; color: string }> = {
  M: { label: 'Modified', color: 'text-mf-warning' },
  A: { label: 'Added', color: 'text-mf-success' },
  D: { label: 'Deleted', color: 'text-mf-destructive' },
  '??': { label: 'Untracked', color: 'text-mf-text-secondary' },
  R: { label: 'Renamed', color: 'text-mf-info' },
  modified: { label: 'Modified', color: 'text-mf-warning' },
  added: { label: 'Added', color: 'text-mf-success' },
};

function splitPath(filePath: string): { name: string; dir: string } {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash === -1) return { name: filePath, dir: '' };
  return { name: filePath.slice(lastSlash + 1), dir: filePath.slice(0, lastSlash) };
}

export function ChangesTab(): React.ReactElement {
  const activeProjectId = useActiveProjectId();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const activeChat = useChatsStore((s) => s.chats.find((c) => c.id === s.activeChatId));
  const { openDiffTab } = useTabsStore();
  const fileView = useTabsStore((s) => s.fileView);
  const [mode, setMode] = useState<Mode>('session');
  const [sessionDiffs, setSessionDiffs] = useState<string[]>([]);
  const [branchData, setBranchData] = useState<BranchDiffResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Register Session/Branch tabs with ZoneHeader
  const changeTabs = useMemo(
    () => [
      { id: 'session', label: 'Session' },
      { id: 'branch', label: 'Branch' },
    ],
    [],
  );
  const handleModeChange = useCallback((tabId: string) => setMode(tabId as Mode), []);
  useZoneHeaderTabs(changeTabs, mode, handleModeChange);

  const refreshSession = async (): Promise<void> => {
    if (!activeChatId) return;
    setLoading(true);
    try {
      const result = await getSessionDiffs(activeChatId);
      setSessionDiffs(result.files);
    } catch {
      setSessionDiffs([]);
    }
    setLoading(false);
  };

  const refreshBranch = async (): Promise<void> => {
    if (!activeProjectId) return;
    setLoading(true);
    try {
      const result = await getBranchDiffs(activeProjectId, activeChatId ?? undefined);
      setBranchData(result);
    } catch {
      setBranchData(null);
    }
    setLoading(false);
  };

  const refresh = mode === 'branch' ? refreshBranch : refreshSession;

  useEffect(() => {
    if (mode === 'branch') refreshBranch();
  }, [activeProjectId]);

  useEffect(() => {
    if (mode === 'session') refreshSession();
    else refreshBranch();
  }, [activeChatId, mode]);

  useEffect(() => {
    if (mode !== 'session' || !activeChatId) return;
    return daemonClient.onEvent((event) => {
      if (event.type === 'context.updated' && event.chatId === activeChatId) {
        refreshSession();
      }
    });
  }, [mode, activeChatId]);

  const branchFiles = branchData?.files ?? [];
  const fileCount = mode === 'session' ? sessionDiffs.length : branchFiles.length;

  return (
    <div className="h-full flex flex-col">
      {/* Header row */}
      <div className="flex items-center justify-between px-2 py-0.5">
        <span className="text-mf-label text-mf-text-secondary">
          {mode === 'session' && !activeChatId
            ? 'No active session'
            : `${fileCount} changed file${fileCount !== 1 ? 's' : ''}`}
        </span>
        {activeChat?.branchName && activeChat?.worktreePath && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-mf-label text-mf-accent" tabIndex={0}>
                Worktree: {activeChat.branchName}
              </span>
            </TooltipTrigger>
            <TooltipContent>{activeChat.worktreePath}</TooltipContent>
          </Tooltip>
        )}
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

      {/* File list */}
      <ScrollArea className="flex-1">
        {mode === 'session' ? (
          <SessionFileList
            files={sessionDiffs}
            activeChatId={activeChatId}
            fileView={fileView}
            openDiffTab={openDiffTab}
          />
        ) : (
          <BranchFileList data={branchData} activeChatId={activeChatId} fileView={fileView} openDiffTab={openDiffTab} />
        )}
      </ScrollArea>
    </div>
  );
}

function SessionFileList({
  files,
  activeChatId,
  fileView,
  openDiffTab,
}: {
  files: string[];
  activeChatId: string | null;
  fileView: ReturnType<typeof useTabsStore.getState>['fileView'];
  openDiffTab: ReturnType<typeof useTabsStore.getState>['openDiffTab'];
}): React.ReactElement {
  if (!activeChatId) {
    return <EmptyState text="Select a session to view its changes" />;
  }
  if (files.length === 0) {
    return <EmptyState text="No changes in this session" />;
  }

  return (
    <div className="space-y-0.5 px-1">
      {files.map((filePath) => {
        const { name, dir } = splitPath(filePath);
        const isActive = fileView?.type === 'diff' && fileView.filePath === filePath;
        return (
          <button
            key={filePath}
            onClick={() => openDiffTab(filePath, 'git', activeChatId, undefined, undefined)}
            className={cn(
              'w-full flex items-center gap-2 px-2 py-1 rounded-mf-input text-left',
              isActive ? 'bg-mf-hover' : 'hover:bg-mf-hover/50',
            )}
          >
            <FileText size={14} className="text-mf-text-secondary shrink-0" />
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex-1 min-w-0 truncate" tabIndex={0}>
                  <span className="text-mf-small text-mf-text-primary">{name}</span>
                  {dir && <span className="text-mf-small text-mf-text-secondary ml-1">{dir}</span>}
                </span>
              </TooltipTrigger>
              <TooltipContent>{filePath}</TooltipContent>
            </Tooltip>
          </button>
        );
      })}
    </div>
  );
}

function BranchFileList({
  data,
  activeChatId,
  fileView,
  openDiffTab,
}: {
  data: BranchDiffResponse | null;
  activeChatId: string | null;
  fileView: ReturnType<typeof useTabsStore.getState>['fileView'];
  openDiffTab: ReturnType<typeof useTabsStore.getState>['openDiffTab'];
}): React.ReactElement {
  if (!data || data.branch === null) {
    return <EmptyState text="Not a git repository" />;
  }
  if (data.files.length === 0) {
    return <EmptyState text="No changes on this branch" />;
  }

  return (
    <div className="space-y-0.5 px-1">
      {data.baseBranch && (
        <p className="text-[11px] leading-tight text-mf-text-secondary opacity-60 px-2 pb-1">
          Comparing {data.branch} against {data.baseBranch}
        </p>
      )}
      {data.files.map((file) => {
        const info = statusLabels[file.status] ?? { label: file.status, color: 'text-mf-text-secondary' };
        const { name, dir } = splitPath(file.path);
        const isActive = fileView?.type === 'diff' && fileView.source === 'git' && fileView.filePath === file.path;
        return (
          <button
            key={file.path}
            onClick={() =>
              openDiffTab(file.path, 'git', activeChatId ?? undefined, file.oldPath, data.mergeBase ?? undefined)
            }
            className={cn(
              'w-full flex items-center gap-2 px-2 py-1 rounded-mf-input text-left',
              isActive ? 'bg-mf-hover' : 'hover:bg-mf-hover/50',
            )}
          >
            <FileText size={14} className="text-mf-text-secondary shrink-0" />
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex-1 min-w-0 truncate" tabIndex={0}>
                  <span className="text-mf-small text-mf-text-primary">{name}</span>
                  {dir && <span className="text-mf-small text-mf-text-secondary ml-1">{dir}</span>}
                </span>
              </TooltipTrigger>
              <TooltipContent>{file.path}</TooltipContent>
            </Tooltip>
            <span className={cn('text-mf-status font-medium shrink-0', info.color)}>{info.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function EmptyState({ text }: { text: string }): React.ReactElement {
  return <div className="text-mf-small text-mf-text-secondary text-center py-4">{text}</div>;
}
