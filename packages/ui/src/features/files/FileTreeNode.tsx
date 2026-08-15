/**
 * FileTreeNode — one row of `FileTree`, recursive over its own children.
 *
 * Split out of `FileTree.tsx` to keep that file under the repo's line limit;
 * behavior (lazy expand, reveal auto-expand/scroll/highlight) is unchanged.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, File, Folder } from 'lucide-react';
import { getFileTree, type FileTreeEntry } from '@/lib/api/files';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { TruncatedWithTooltip } from '@/components/ui/truncated-with-tooltip';
import { FileTreeRowMenu } from './FileTreeRowMenu';
import { isAncestorOf, sortEntries, toFullPath } from './file-tree-utils';

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

export function FileTreeNode({ entry, depth, port, projectId, chatId, base, revealPath, activeFilePath }: NodeProps) {
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
            'flex h-[22px] w-full items-center gap-[5px] border-l-2 border-solid pr-[12px] text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground',
            isSelected ? 'border-l-primary bg-accent font-semibold text-foreground' : 'border-l-transparent',
            isRevealTarget ? 'bg-accent/60 text-foreground' : 'bg-transparent',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className="w-[9px] flex-shrink-0" />
          <File size={12} className="flex-shrink-0 text-muted-foreground" />
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
          className="flex h-[22px] w-full items-center gap-[5px] border-none bg-transparent pr-[12px] text-left text-xs font-medium text-foreground hover:bg-accent"
        >
          <ChevronRight
            size={12}
            className={`flex-shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
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
          <FileTreeNode
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
