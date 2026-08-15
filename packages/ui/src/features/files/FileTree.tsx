/**
 * FileTree — a lazy, expandable project file tree for the workspace's
 * docked Files sidebar.
 *
 * Directories fetch their children on first expand via `getFileTree(dir)`
 * (the daemon returns a single level per call). Clicking a file emits the
 * `open-file` surface intent — the same path the chat tool-cards use — so the
 * workspace surface lights and the file opens as a tab. No `layout/` import.
 *
 * The header row (workspace-root label, refresh, collapse) sits in
 * `SidebarHeader` so it never scrolls; only the rows scroll, inside
 * `SidebarScrollRegion` (the shared scroll-fade primitive `SessionSidebar`
 * also uses — see that file for why a hand-rolled `overflow-y-auto` isn't
 * used here). Both live under the single `data-testid="file-tree"` root so
 * the root label stays reachable via that testid (e2e right-clicks it).
 *
 * Reveal support: when the files store has a `revealTarget`, the tree
 * auto-expands ancestor directories, scrolls the target row into view, and
 * transiently highlights it. The target is consumed (cleared) on mount so a
 * subsequent remount does not re-trigger the reveal.
 */
import { useCallback, useEffect, useState } from 'react';
import { PanelRightClose, RotateCw } from 'lucide-react';
import { getFileTree, type FileTreeEntry } from '@/lib/api/files';
import { useFilesStore } from '@/store/files';
import { useLayoutStore } from '@/store/layout';
import { activeFileTab } from '@/store/run-pane-file-tabs';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { SidebarHeader } from '@/components/ui/sidebar';
import { Hint } from '@/components/ui/hint';
import { FileTreeRowMenu } from './FileTreeRowMenu';
import { FileTreeNode } from './FileTreeNode';
import { SidebarScrollRegion } from '@/features/shared/SidebarScrollRegion';
import { lastSegment, sortEntries } from './file-tree-utils';

interface FileTreeProps {
  port: number;
  projectId: string;
  chatId?: string;
  /** Renders the panel-close control next to Refresh — the tree's
   *  project-name row IS the docked Files sidebar's header (no separate row). */
  onCollapse?: () => void;
}

export function FileTree({ port, projectId, chatId, onCollapse }: FileTreeProps) {
  const [roots, setRoots] = useState<FileTreeEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // The path of the file open in the active workspace tab — highlights the selected row.
  const activeTabPath = useLayoutStore((s) => activeFileTab(s.run)?.path ?? null);

  // Absolute workspace base (worktree wins over project) for Reveal/Copy Path.
  const base = useActiveBasesStore((s) => s.bases.worktreePath ?? s.bases.projectPath);

  // Subscribe reactively so reveals fired while this component is already
  // mounted (e.g. the ViewerShell "Reveal" button) are picked up live.
  // The effect mirrors the store value into local state and clears the store
  // entry immediately, preventing a subsequent remount from re-triggering.
  const storeTarget = useFilesStore((s) => s.revealTarget);
  const [revealPath, setRevealPath] = useState<string | null>(null);

  useEffect(() => {
    if (storeTarget === null) return;
    setRevealPath(storeTarget);
    useFilesStore.getState().consumeRevealTarget();
  }, [storeTarget]);

  useEffect(() => {
    let cancelled = false;
    setRoots(null);
    setError(false);
    getFileTree(port, projectId, '.', chatId)
      .then((entries) => {
        if (!cancelled) setRoots(entries);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn('[FileTree] failed to load root', projectId, err);
        setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [port, projectId, chatId, refreshKey]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  if (error) {
    return <div className="px-3 py-4 text-xs text-muted-foreground">Couldn't load files.</div>;
  }
  if (roots === null) {
    return <div className="px-3 py-4 text-xs text-muted-foreground">Loading…</div>;
  }
  if (roots.length === 0) {
    return <div className="px-3 py-4 text-xs text-muted-foreground">No files.</div>;
  }

  return (
    <div data-testid="file-tree" className="flex min-h-0 flex-1 flex-col">
      <SidebarHeader className="h-[20px] flex-row items-center gap-0 px-[12px] py-[4px]">
        <FileTreeRowMenu entry={{ name: '.', path: '.', type: 'directory' }} fullPath={base ?? projectId}>
          <span className="flex-1 truncate font-mono text-xs font-medium text-muted-foreground">
            {lastSegment(base ?? projectId)}
          </span>
        </FileTreeRowMenu>
        <Hint label="Refresh">
          <button
            data-testid="file-tree-refresh"
            type="button"
            onClick={refresh}
            className="inline-flex h-[20px] w-[20px] flex-shrink-0 items-center justify-center rounded-[4px] border-none bg-transparent hover:bg-accent"
          >
            <RotateCw size={14} className="text-muted-foreground" />
          </button>
        </Hint>
        {onCollapse && (
          <Hint label="Collapse files">
            <button
              data-testid="workspace-files-collapse"
              type="button"
              onClick={onCollapse}
              className="inline-flex h-[20px] w-[20px] flex-shrink-0 items-center justify-center rounded-[4px] border-none bg-transparent hover:bg-accent"
            >
              <PanelRightClose size={14} className="text-muted-foreground" />
            </button>
          </Hint>
        )}
      </SidebarHeader>
      <SidebarScrollRegion>
        <div className="py-[4px]">
          {sortEntries(roots).map((entry) => (
            <FileTreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              port={port}
              projectId={projectId}
              chatId={chatId}
              base={base}
              revealPath={revealPath}
              activeFilePath={activeTabPath}
            />
          ))}
        </div>
      </SidebarScrollRegion>
    </div>
  );
}
