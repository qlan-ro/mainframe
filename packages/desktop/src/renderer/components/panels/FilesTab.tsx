import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Folder, FileText, ChevronRight, ChevronDown, RefreshCw } from 'lucide-react';
import { FindInPathModal } from '../FindInPathModal';
import { daemonClient } from '../../lib/client';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:panels');
import { useProjectsStore } from '../../store';
import { useActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { useChatsStore } from '../../store/chats';
import { useTabsStore } from '../../store/tabs';
import { getFileTree } from '../../lib/api';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { ScrollArea } from '../ui/scroll-area';
import { ContextMenu } from '../ui/context-menu';
import type { ContextMenuItem } from '../ui/context-menu';

interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  path: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface FileTreeNodeProps {
  entry: FileEntry;
  depth: number;
  projectPath: string;
  activeProjectId: string | null;
  activeChatId: string | null;
  revealPath: string | null;
  onContextMenu: (e: React.MouseEvent, entryPath: string, entryType: 'file' | 'directory') => void;
  onOpenEditorTab: (path: string) => void;
  onToggleTreePath: (path: string) => void;
  onClearRevealPath: () => void;
  refreshKey: number;
}

function FileTreeNode({
  entry,
  depth,
  projectPath,
  activeProjectId,
  activeChatId,
  revealPath,
  onContextMenu,
  onOpenEditorTab,
  onToggleTreePath,
  onClearRevealPath,
  refreshKey,
}: FileTreeNodeProps): React.ReactElement {
  const [children, setChildren] = useState<FileEntry[]>([]);
  const expanded = useTabsStore((s) => entry.type === 'directory' && s.expandedPaths.includes(entry.path));
  const isActive = useTabsStore(
    (s) => entry.type === 'file' && s.fileView?.type === 'editor' && s.fileView.filePath === entry.path,
  );

  const nodeRef = useRef<HTMLButtonElement>(null);

  // Load/refresh children when expanded
  useEffect(() => {
    if (entry.type !== 'directory' || !expanded || !activeProjectId) return;
    let cancelled = false;
    getFileTree(activeProjectId, entry.path, activeChatId ?? undefined)
      .then((entries) => {
        if (!cancelled) setChildren(entries);
      })
      .catch((err) => {
        if (!cancelled) log.warn('load file tree failed', { err: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, refreshKey, activeProjectId, activeChatId, entry.path, entry.type]);

  // Scroll into view when this is the reveal target
  useEffect(() => {
    if (revealPath === entry.path && nodeRef.current) {
      nodeRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
      onClearRevealPath();
    }
  }, [revealPath, entry.path, onClearRevealPath]);

  const handleClick = (): void => {
    if (entry.type === 'directory') {
      onToggleTreePath(entry.path);
    } else {
      onOpenEditorTab(entry.path);
    }
  };

  return (
    <>
      <button
        ref={nodeRef}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, entry.path, entry.type)}
        className={cn(
          'w-full flex items-center gap-1 py-1 px-2 text-mf-small rounded-mf-input text-left',
          isActive ? 'bg-mf-hover' : 'hover:bg-mf-hover/50',
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {entry.type === 'directory' ? (
          <>
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Folder size={14} className="text-mf-accent shrink-0" />
          </>
        ) : (
          <>
            <span className="w-3" />
            <FileText size={14} className="text-mf-text-secondary shrink-0" />
          </>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn('truncate', entry.type === 'file' ? 'text-mf-text-secondary' : 'text-mf-text-primary')}
              tabIndex={0}
            >
              {entry.name}
            </span>
          </TooltipTrigger>
          <TooltipContent>{entry.name}</TooltipContent>
        </Tooltip>
      </button>
      {expanded &&
        children.map((child) => (
          <FileTreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            projectPath={projectPath}
            activeProjectId={activeProjectId}
            activeChatId={activeChatId}
            revealPath={revealPath}
            onContextMenu={onContextMenu}
            onOpenEditorTab={onOpenEditorTab}
            onToggleTreePath={onToggleTreePath}
            onClearRevealPath={onClearRevealPath}
            refreshKey={refreshKey}
          />
        ))}
    </>
  );
}

export function FilesTab(): React.ReactElement {
  const activeProjectId = useActiveProjectId();
  const activeProject = useProjectsStore((s) => s.projects.find((p) => p.id === activeProjectId));
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const activeChatWorktreePath = useChatsStore((s) => s.chats.find((c) => c.id === s.activeChatId)?.worktreePath);
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const rootExpanded = useTabsStore((s) => s.expandedPaths.includes('.'));
  const toggleTreePath = useTabsStore((s) => s.toggleTreePath);
  const revealPath = useTabsStore((s) => s.revealPath);
  const openEditorTab = useTabsStore((s) => s.openEditorTab);
  const clearRevealPath = useTabsStore((s) => s.clearRevealPath);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [findInPath, setFindInPath] = useState<{ scopePath: string; scopeType: 'file' | 'directory' } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activeProjectId) return;
    getFileTree(activeProjectId, '.', activeChatId ?? undefined)
      .then(setRootEntries)
      .catch((err) => log.warn('load file tree failed', { err: String(err) }));
  }, [activeProjectId, activeChatId, refreshKey]);

  useEffect(() => {
    if (!activeChatId) return;
    const unsub = daemonClient.onEvent((event) => {
      if (event.type === 'context.updated' && event.chatId === activeChatId) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          setRefreshKey((k) => k + 1);
        }, 500);
      }
    });
    return () => {
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [activeChatId]);

  useEffect(() => {
    const onFocus = (): void => setRefreshKey((k) => k + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, entryPath: string, entryType: 'file' | 'directory' = 'directory') => {
      e.preventDefault();
      if (!activeProject) return;

      const sep = activeProject.path.includes('\\') ? '\\' : '/';
      const fullPath = `${activeProject.path}${sep}${entryPath}`;

      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: entryType === 'directory' ? 'Find in Path...' : 'Find in File...',
            onClick: () => {
              setFindInPath({
                scopePath: entryPath,
                scopeType: entryType,
              });
            },
          },
          {
            label: 'Reveal in Finder',
            onClick: () => {
              window.mainframe?.showItemInFolder(fullPath);
            },
          },
          {
            label: 'Copy Path',
            onClick: () => {
              navigator.clipboard.writeText(fullPath);
            },
          },
          {
            label: 'Copy Relative Path',
            onClick: () => {
              navigator.clipboard.writeText(entryPath);
            },
          },
        ],
      });
    },
    [activeProject],
  );

  if (!activeProject) {
    return <div className="text-mf-small text-mf-text-secondary text-center py-4">No project selected</div>;
  }

  const displayPath = activeChatWorktreePath ?? activeProject.path;

  return (
    <>
      <ScrollArea className="h-full">
        <div className="py-1">
          <div className="@container flex items-center">
            <button
              onClick={() => toggleTreePath('.')}
              onContextMenu={(e) => handleContextMenu(e, '.', 'directory')}
              className="flex-1 flex items-center gap-1 py-1 px-2 text-mf-small hover:bg-mf-hover/50 rounded-mf-input text-left font-semibold text-mf-text-primary min-w-0"
            >
              {rootExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Folder size={14} className="text-mf-accent shrink-0" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="truncate" tabIndex={0}>
                    {displayPath}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{displayPath}</TooltipContent>
              </Tooltip>
            </button>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setRefreshKey((k) => k + 1)}
                  className="hidden @min-[160px]:block p-1.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors shrink-0"
                  aria-label="Refresh file tree"
                >
                  <RefreshCw size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Refresh file tree</TooltipContent>
            </Tooltip>
          </div>
          {rootExpanded &&
            rootEntries.map((entry) => (
              <FileTreeNode
                key={entry.path}
                entry={entry}
                depth={1}
                projectPath={activeProject.path}
                activeProjectId={activeProjectId}
                activeChatId={activeChatId}
                revealPath={revealPath}
                onContextMenu={handleContextMenu}
                onOpenEditorTab={openEditorTab}
                onToggleTreePath={toggleTreePath}
                onClearRevealPath={clearRevealPath}
                refreshKey={refreshKey}
              />
            ))}
        </div>
      </ScrollArea>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
      {findInPath && (
        <FindInPathModal
          scopePath={findInPath.scopePath}
          scopeType={findInPath.scopeType}
          onClose={() => setFindInPath(null)}
        />
      )}
    </>
  );
}
