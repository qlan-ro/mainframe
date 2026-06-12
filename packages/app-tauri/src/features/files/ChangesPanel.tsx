/**
 * ChangesPanel — the Inspector's Changes tab: working-tree git status.
 * Clicking a changed file opens it in the editor (via the open-file intent).
 * A HEAD-vs-working diff view is a follow-up (needs the git/diff plumbing).
 */
import { useEffect, useState } from 'react';
import { getGitStatus, type GitStatusFile } from '@/lib/api/git';
import { emitSurfaceIntent } from '@/store/surface-intents';

/** Short status code → a tint class (added/modified/deleted). */
function statusClass(code: string): string {
  if (code.includes('A') || code === '??') return 'text-mf-diff-add-text';
  if (code.includes('D')) return 'text-mf-diff-del-text';
  if (code.includes('M')) return 'text-mf-warning';
  return 'text-mf-warning';
}

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

interface ChangesPanelProps {
  port: number;
  projectId: string;
  chatId?: string;
}

export function ChangesPanel({ port, projectId, chatId }: ChangesPanelProps) {
  const [files, setFiles] = useState<GitStatusFile[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFiles(null);
    setError(false);
    getGitStatus(port, projectId, chatId)
      .then((f) => {
        if (!cancelled) setFiles(f);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn('[ChangesPanel] failed to load git status', projectId, err);
        setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [port, projectId, chatId]);

  if (error) return <div className="px-3 py-4 text-caption text-muted-foreground">Couldn’t load changes.</div>;
  if (files === null) return <div className="px-3 py-4 text-caption text-muted-foreground">Loading…</div>;
  if (files.length === 0) return <div className="px-3 py-4 text-caption text-muted-foreground">No changes.</div>;

  return (
    <div data-testid="changes-panel" className="py-1">
      {files.map((f) => (
        <button
          key={f.path}
          data-testid={`changes-row-${f.path}`}
          type="button"
          title={f.path}
          onClick={() => emitSurfaceIntent({ type: 'open-file', path: f.path })}
          className="flex h-[22px] w-full items-center gap-2 border-none bg-transparent px-3 text-left text-caption text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <span
            data-testid={`changes-status-${f.path}`}
            className={`w-3 flex-shrink-0 text-center font-mono text-micro ${statusClass(f.status)}`}
          >
            {f.status.trim().charAt(0) || '•'}
          </span>
          <span className="truncate text-foreground">{basename(f.path)}</span>
          <span className="ml-auto truncate font-mono text-micro text-mf-text-4">{f.path}</span>
        </button>
      ))}
    </div>
  );
}
