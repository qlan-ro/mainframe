import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Folder, FileText, ChevronRight, ChevronDown, RefreshCw } from 'lucide-react';
import { daemonClient } from '../../lib/client';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:panels');
import { useProjectsStore } from '../../store';
import { useChatsStore } from '../../store/chats';
import { useTabsStore } from '../../store/tabs';
import { getFileTree } from '../../lib/api';
import { cn } from '../../lib/utils';
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

function FileTreeNode({
  entry,
  depth,
  projectPath,
  onContextMenu,
  refreshKey,
}: {
  entry: FileEntry;
  depth: number;
  projectPath: string;
  onContextMenu: (e: React.MouseEvent, entryPath: string) => void;
  refreshKey: number;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const { activeProjectId } = useProjectsStore();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const { openEditorTab } = useTabsStore();

  const isActive = useTabsStore(
    (s) => entry.type === 'file' && s.fileView?.type === 'editor' && s.fileView.filePath === entry.path,
  );

  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const childrenRef = useRef(children);
  childrenRef.current = children;

  useEffect(() => {
    if (refreshKey === 0) return;
    if (entry.type !== 'directory') return;
    let cancelled = false;
    if (expandedRef.current && activeProjectId) {
      getFileTree(activeProjectId, entry.path, activeChatId ?? undefined)
        .then((entries) => {
          if (!cancelled) setChildren(entries);
        })
        .catch((err) => {
          if (!cancelled) log.warn('refresh file tree failed', { err: String(err) });
        });
    } else if (childrenRef.current.length > 0) {
      // Clear stale cache so next expand fetches fresh data
      setChildren([]);
    }
    return () => {
      cancelled = true;
    };
  }, [refreshKey, activeProjectId, activeChatId, entry.path, entry.type]);

  const handleClick = async (): Promise<void> => {
    if (entry.type === 'directory') {
      if (!expanded && children.length === 0 && activeProjectId) {
        const entries = await getFileTree(activeProjectId, entry.path, activeChatId ?? undefined);
        setChildren(entries);
      }
      setExpanded(!expanded);
    } else {
      openEditorTab(entry.path);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, entry.path)}
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
        <span
          className={cn('truncate', entry.type === 'file' ? 'text-mf-text-secondary' : 'text-mf-text-primary')}
          title={entry.name}
        >
          {entry.name}
        </span>
      </button>
      {expanded &&
        children.map((child) => (
          <FileTreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            projectPath={projectPath}
            onContextMenu={onContextMenu}
            refreshKey={refreshKey}
          />
        ))}
    </>
  );
}

export function FilesTab(): React.ReactElement {
  const { projects, activeProjectId } = useProjectsStore();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
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
    (e: React.MouseEvent, entryPath: string) => {
      e.preventDefault();
      if (!activeProject) return;

      const sep = activeProject.path.includes('\\') ? '\\' : '/';
      const fullPath = `${activeProject.path}${sep}${entryPath}`;

      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
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
        ],
      });
    },
    [activeProject],
  );

  if (!activeProject) {
    return <div className="text-mf-small text-mf-text-secondary text-center py-4">No project selected</div>;
  }

  return (
    <>
      <ScrollArea className="h-full">
        <div className="py-1">
          <div className="flex items-center">
            <button
              onClick={() => setExpanded(!expanded)}
              onContextMenu={(e) => handleContextMenu(e, '.')}
              className="flex-1 flex items-center gap-1 py-1 px-2 text-mf-small hover:bg-mf-hover/50 rounded-mf-input text-left font-semibold text-mf-text-primary min-w-0"
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Folder size={14} className="text-mf-accent shrink-0" />
              <span className="truncate" title={activeProject.path}>
                {activeProject.path}
              </span>
            </button>
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              className="p-1.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors shrink-0"
              title="Refresh file tree"
              aria-label="Refresh file tree"
            >
              <RefreshCw size={14} />
            </button>
          </div>
          {expanded &&
            rootEntries.map((entry) => (
              <FileTreeNode
                key={entry.path}
                entry={entry}
                depth={1}
                projectPath={activeProject.path}
                onContextMenu={handleContextMenu}
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
    </>
  );
}
