import React, { useCallback, useEffect, useState } from 'react';
import { Folder, FileText, ChevronRight, ChevronDown } from 'lucide-react';
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
}: {
  entry: FileEntry;
  depth: number;
  projectPath: string;
  onContextMenu: (e: React.MouseEvent, entryPath: string) => void;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const { activeProjectId } = useProjectsStore();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const { openEditorTab } = useTabsStore();
  const isActive = useTabsStore(
    (s) => entry.type === 'file' && s.fileView?.type === 'editor' && s.fileView.filePath === entry.path,
  );

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

  useEffect(() => {
    if (!activeProjectId) return;
    getFileTree(activeProjectId, '.', activeChatId ?? undefined)
      .then(setRootEntries)
      .catch((err) => log.warn('load file tree failed', { err: String(err) }));
  }, [activeProjectId, activeChatId]);

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
          <button
            onClick={() => setExpanded(!expanded)}
            onContextMenu={(e) => handleContextMenu(e, '.')}
            className="w-full flex items-center gap-1 py-1 px-2 text-mf-small hover:bg-mf-hover/50 rounded-mf-input text-left font-semibold text-mf-text-primary"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Folder size={14} className="text-mf-accent shrink-0" />
            <span className="truncate" title={activeProject.path}>
              {activeProject.path}
            </span>
          </button>
          {expanded &&
            rootEntries.map((entry) => (
              <FileTreeNode
                key={entry.path}
                entry={entry}
                depth={1}
                projectPath={activeProject.path}
                onContextMenu={handleContextMenu}
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
