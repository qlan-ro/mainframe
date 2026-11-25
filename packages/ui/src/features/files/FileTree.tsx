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
import { RotateCw, X } from 'lucide-react';
import { getFileTree, type FileTreeEntry } from '@/lib/api/files';
import { useLayoutStore } from '@/store/layout';
import { activeFileTab } from '@/store/run-pane-file-tabs';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { SidebarHeader } from '@/components/ui/sidebar';
import { Hint } from '@/components/ui/hint';
import { FileTreeRowMenu } from './FileTreeRowMenu';
import { FileTreeNode } from './FileTreeNode';
import { useFileTreeReveal } from './use-file-tree-reveal';
import { SidebarScrollRegion } from '@/features/shared/SidebarScrollRegion';
import { lastSegment, sortEntries } from './file-tree-utils';

const HEADER_ACTION =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:focus-line';

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

  const { revealPath, listings, onVerifiedRow, refreshListings } = useFileTreeReveal(port, projectId, chatId);
  const displayedRoots = listings?.get('.') ?? roots;

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

  const refresh = useCallback(() => {
    refreshListings();
    setRefreshKey((k) => k + 1);
  }, [refreshListings]);

  if (error && displayedRoots === null) {
    return <div className="px-3 py-4 text-meta/[1.45] text-muted-foreground">Couldn't load files.</div>;
  }
  if (displayedRoots === null) {
    return <div className="px-3 py-4 text-meta/[1.45] text-muted-foreground">Loading…</div>;
  }
  if (displayedRoots.length === 0) {
    return <div className="px-3 py-4 text-meta/[1.45] text-muted-foreground">No files.</div>;
  }

  return (
    <div data-testid="file-tree" className="flex min-h-0 flex-1 flex-col">
      <SidebarHeader className="h-9 shrink-0 flex-row items-center gap-0 py-0 pr-1.5 pl-3">
        <FileTreeRowMenu entry={{ name: '.', path: '.', type: 'directory' }} fullPath={base ?? projectId}>
          <span
            className="flex-1 truncate text-label/[1.45] font-medium text-muted-foreground"
            title={lastSegment(base ?? projectId)}
          >
            {onCollapse ? 'Files' : lastSegment(base ?? projectId)}
          </span>
        </FileTreeRowMenu>
        <Hint label="Refresh">
          <button data-testid="file-tree-refresh" type="button" onClick={refresh} className={HEADER_ACTION}>
            <RotateCw size={16} />
          </button>
        </Hint>
        {onCollapse && (
          <Hint label="Collapse files">
            <button data-testid="workspace-files-collapse" type="button" onClick={onCollapse} className={HEADER_ACTION}>
              <X size={16} />
            </button>
          </Hint>
        )}
      </SidebarHeader>
      <SidebarScrollRegion>
        <div className="px-1.5 pb-2">
          {sortEntries(displayedRoots).map((entry) => (
            <FileTreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              port={port}
              projectId={projectId}
              chatId={chatId}
              base={base}
              revealPath={revealPath}
              listings={listings}
              onVerifiedRow={onVerifiedRow}
              activeFilePath={activeTabPath}
            />
          ))}
        </div>
      </SidebarScrollRegion>
    </div>
  );
}
