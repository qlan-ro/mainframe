/**
 * FileTree — a lazy, expandable project file tree for the Inspector.
 *
 * Directories fetch their children on first expand via `getFileTree(dir)`
 * (the daemon returns a single level per call). Clicking a file emits the
 * `open-file` surface intent — the same path the chat tool-cards use — so the
 * Files surface activates and the file opens as a tab. No `layout/` import.
 */
import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, FileText, Folder } from 'lucide-react';
import { getFileTree, type FileTreeEntry } from '@/lib/api/files';
import { emitSurfaceIntent } from '@/store/surface-intents';

/** Directories first, then files, each alphabetical. */
function sortEntries(entries: FileTreeEntry[]): FileTreeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

interface NodeProps {
  entry: FileTreeEntry;
  depth: number;
  port: number;
  projectId: string;
  chatId?: string;
}

function TreeNode({ entry, depth, port, projectId, chatId }: NodeProps) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FileTreeEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const indent = 8 + depth * 12;

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (next && children === null && !loading) {
      setLoading(true);
      try {
        setChildren(await getFileTree(port, projectId, entry.path, chatId));
      } catch (err) {
        console.warn('[FileTree] failed to load', entry.path, err);
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
  }, [open, children, loading, port, projectId, entry.path, chatId]);

  if (entry.type === 'file') {
    return (
      <button
        data-testid={`file-tree-row-${entry.path}`}
        type="button"
        onClick={() => emitSurfaceIntent({ type: 'open-file', path: entry.path })}
        style={{ paddingLeft: indent }}
        className="flex h-[22px] w-full items-center gap-1.5 border-none bg-transparent pr-3 text-left text-caption text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <span className="w-[9px] flex-shrink-0" />
        <FileText size={11} className="flex-shrink-0 text-mf-text-3" />
        <span className="truncate">{entry.name}</span>
      </button>
    );
  }

  return (
    <>
      <button
        data-testid={`file-tree-row-${entry.path}`}
        type="button"
        onClick={toggle}
        style={{ paddingLeft: indent }}
        className="flex h-[22px] w-full items-center gap-1.5 border-none bg-transparent pr-3 text-left text-caption font-medium text-foreground hover:bg-accent"
      >
        <ChevronRight
          size={9}
          className={`flex-shrink-0 text-mf-text-3 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <Folder size={12} className="flex-shrink-0 text-mf-surface-files" />
        <span className="truncate">{entry.name}</span>
      </button>
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
  }, [port, projectId, chatId]);

  if (error) {
    return <div className="px-3 py-4 text-caption text-muted-foreground">Couldn’t load files.</div>;
  }
  if (roots === null) {
    return <div className="px-3 py-4 text-caption text-muted-foreground">Loading…</div>;
  }
  if (roots.length === 0) {
    return <div className="px-3 py-4 text-caption text-muted-foreground">No files.</div>;
  }

  return (
    <div data-testid="file-tree" className="py-1">
      {sortEntries(roots).map((entry) => (
        <TreeNode key={entry.path} entry={entry} depth={0} port={port} projectId={projectId} chatId={chatId} />
      ))}
    </div>
  );
}
