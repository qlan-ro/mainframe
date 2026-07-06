/**
 * FileTree — a lazy, expandable project file tree for the Inspector.
 *
 * Directories fetch their children on first expand via `getFileTree(dir)`
 * (the daemon returns a single level per call). Clicking a file emits the
 * `open-file` surface intent — the same path the chat tool-cards use — so the
 * Files surface activates and the file opens as a tab. No `layout/` import.
 *
 * Reveal support: when the files store has a `revealTarget`, the tree
 * auto-expands ancestor directories, scrolls the target row into view, and
 * transiently highlights it. The target is consumed (cleared) on mount so a
 * subsequent remount does not re-trigger the reveal.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, File, Folder, RotateCw } from 'lucide-react';
import { getFileTree, type FileTreeEntry } from '@/lib/api/files';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useFilesStore } from '@/store/files';
import { useTabsStore } from '@/store/tabs';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { TruncatedWithTooltip } from '@/components/ui/truncated-with-tooltip';
import { FileTreeRowMenu } from './FileTreeRowMenu';
import { Hint } from '@/components/ui/hint';

/** Join an absolute base with a repo-relative path; falls back to the relative path when no base is known. */
function toFullPath(base: string | undefined, relativePath: string): string {
  return base ? `${base}/${relativePath}` : relativePath;
}

/** Last path segment (folder/file name) of an absolute or relative path. */
function lastSegment(path: string): string {
  const i = path.replace(/\/+$/, '').lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

/** Directories first, then files, each alphabetical. */
function sortEntries(entries: FileTreeEntry[]): FileTreeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** True when `candidatePath` is a strict ancestor of `targetPath`. */
function isAncestorOf(candidatePath: string, targetPath: string): boolean {
  return targetPath.startsWith(candidatePath + '/');
}

interface NodeProps {
  entry: FileTreeEntry;
  depth: number;
  port: number;
  projectId: string;
  chatId?: string;
  /** Absolute workspace base (worktree/project path) for Reveal/Copy Path actions. */
  base: string | undefined;
  /** Normalized relative path to reveal, or null when no reveal is pending. */
  revealPath: string | null;
  /** Path of the file currently open in the active tab. */
  activeFilePath: string | null;
}

function TreeNode({ entry, depth, port, projectId, chatId, base, revealPath, activeFilePath }: NodeProps) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FileTreeEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const indent = 8 + depth * 12;

  const isRevealTarget = revealPath !== null && entry.path === revealPath;
  const isRevealAncestor = entry.type === 'directory' && revealPath !== null && isAncestorOf(entry.path, revealPath);
  const isSelected = entry.type === 'file' && entry.path === activeFilePath;

  const rowRef = useRef<HTMLButtonElement>(null);

  const fetchChildren = useCallback(async () => {
    if (children !== null || loading) return;
    setLoading(true);
    try {
      setChildren(await getFileTree(port, projectId, entry.path, chatId));
    } catch (err) {
      console.warn('[FileTree] failed to load', entry.path, err);
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, [children, loading, port, projectId, entry.path, chatId]);

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      await fetchChildren();
    }
  }, [open, fetchChildren]);

  // Auto-expand ancestor directories to reach the reveal target — but only ONCE
  // per reveal. The latch is load-bearing: without it, collapsing an ancestor of
  // the last-revealed file re-fires this effect (open flips to false while the
  // node is still a reveal-ancestor) and immediately re-opens it, making the
  // folder impossible to collapse. Keyed on revealPath so a NEW reveal re-arms it.
  const autoExpandedRevealRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isRevealAncestor || revealPath === null) return;
    if (autoExpandedRevealRef.current === revealPath) return;
    autoExpandedRevealRef.current = revealPath;
    if (open) return;
    setOpen(true);
    fetchChildren().catch((err: unknown) => {
      console.warn('[FileTree] reveal auto-expand failed', entry.path, err);
    });
  }, [isRevealAncestor, revealPath, open, fetchChildren, entry.path]);

  // Scroll and highlight the target row once it's mounted in the DOM.
  useEffect(() => {
    if (!isRevealTarget || rowRef.current === null) return;
    rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [isRevealTarget]);

  const fullPath = toFullPath(base, entry.path);

  if (entry.type === 'file') {
    return (
      <FileTreeRowMenu entry={entry} fullPath={fullPath}>
        <button
          ref={rowRef}
          data-testid={`file-tree-row-${entry.path}`}
          data-kind="file"
          data-highlighted={isRevealTarget ? 'true' : undefined}
          type="button"
          onClick={() => emitSurfaceIntent({ type: 'open-file', path: entry.path })}
          style={{ paddingLeft: indent }}
          className={[
            'flex h-[22px] w-full items-center gap-[5px] border-l-2 border-solid pr-[12px] text-left text-label text-muted-foreground hover:bg-accent hover:text-foreground',
            isSelected ? 'border-l-primary bg-accent font-semibold text-foreground' : 'border-l-transparent',
            isRevealTarget ? 'bg-accent/60 text-foreground' : 'bg-transparent',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className="w-[9px] flex-shrink-0" />
          <File size={11} className="flex-shrink-0 text-mf-text-3" />
          <TruncatedWithTooltip
            text={entry.name}
            tooltip={fullPath}
            className="min-w-0"
            contentClassName="font-mono break-all"
          />
        </button>
      </FileTreeRowMenu>
    );
  }

  return (
    <>
      <FileTreeRowMenu entry={entry} fullPath={fullPath}>
        <button
          data-testid={`file-tree-row-${entry.path}`}
          data-kind="directory"
          type="button"
          onClick={toggle}
          style={{ paddingLeft: indent }}
          className="flex h-[22px] w-full items-center gap-[5px] border-none bg-transparent pr-[12px] text-left text-label font-medium text-foreground hover:bg-accent"
        >
          <ChevronRight
            size={9}
            className={`flex-shrink-0 text-mf-text-3 transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <Folder size={12} className="flex-shrink-0 fill-current text-primary" />
          <TruncatedWithTooltip
            text={entry.name}
            tooltip={fullPath}
            className="min-w-0"
            contentClassName="font-mono break-all"
          />
        </button>
      </FileTreeRowMenu>
      {open &&
        (children ?? []).length > 0 &&
        sortEntries(children!).map((child) => (
          <TreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            port={port}
            projectId={projectId}
            chatId={chatId}
            base={base}
            revealPath={revealPath}
            activeFilePath={activeFilePath}
          />
        ))}
    </>
  );
}

interface FileTreeProps {
  port: number;
  projectId: string;
  chatId?: string;
}

export function FileTree({ port, projectId, chatId }: FileTreeProps) {
  const [roots, setRoots] = useState<FileTreeEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // The path of the file open in the active tab — used to highlight the selected row.
  const activeTabPath = useTabsStore((s) => {
    const active = s.tabs.find((t) => t.id === s.activeTabId);
    return active?.path ?? null;
  });

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

  if (error) {
    return <div className="px-3 py-4 text-caption text-muted-foreground">Couldn't load files.</div>;
  }
  if (roots === null) {
    return <div className="px-3 py-4 text-caption text-muted-foreground">Loading…</div>;
  }
  if (roots.length === 0) {
    return <div className="px-3 py-4 text-caption text-muted-foreground">No files.</div>;
  }

  return (
    <div data-testid="file-tree">
      {/* Header row: workspace-root label (right-clickable) + refresh button */}
      <div className="flex h-[20px] items-center px-[12px] py-[4px]">
        <FileTreeRowMenu entry={{ name: '.', path: '.', type: 'directory' }} fullPath={base ?? projectId}>
          <span className="flex-1 truncate font-mono text-micro font-semibold uppercase text-mf-text-3 [letter-spacing:0.6px]">
            {lastSegment(base ?? projectId)}
          </span>
        </FileTreeRowMenu>
        <Hint label="Refresh">
          <button
            data-testid="file-tree-refresh"
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            className="inline-flex h-[20px] w-[20px] flex-shrink-0 items-center justify-center rounded-[4px] border-none bg-transparent hover:bg-accent"
          >
            <RotateCw size={11} className="text-mf-text-3" />
          </button>
        </Hint>
      </div>
      <div className="py-[4px]">
        {sortEntries(roots).map((entry) => (
          <TreeNode
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
    </div>
  );
}
