/**
 * ChangesPanel — the Inspector's Changes tab: working-tree git status.
 * Clicking a changed file opens a HEAD-vs-working diff tab (via the open-diff intent).
 */
import { useEffect, useState } from 'react';
import { FileText, RotateCw } from 'lucide-react';
import { getGitStatus, type GitStatusFile } from '@/lib/api/git';
import { gitStatusKind } from '@/lib/git-status-kind';
import { emitSurfaceIntent } from '@/store/surface-intents';

type ScopeMode = 'session' | 'uncommitted' | 'branch';

const SCOPE_MODES: { id: ScopeMode; label: string }[] = [
  { id: 'session', label: 'Session' },
  { id: 'uncommitted', label: 'Uncommitted' },
  { id: 'branch', label: 'Branch' },
];

/** Semantic kind → full-word label. */
const KIND_WORD: Record<string, string> = {
  added: 'Added',
  deleted: 'Deleted',
  modified: 'Modified',
  renamed: 'Renamed',
};

/** Semantic kind → Tailwind color class. */
const KIND_CLASS: Record<string, string> = {
  added: 'text-mf-diff-add-text',
  deleted: 'text-mf-diff-del-text',
  modified: 'text-mf-warning',
  renamed: 'text-mf-warning',
};

function statusClass(code: string): string {
  return KIND_CLASS[gitStatusKind(code)] ?? 'text-mf-warning';
}

function statusWord(code: string): string {
  return KIND_WORD[gitStatusKind(code)] ?? 'Modified';
}

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '.' : path.slice(0, i);
}

interface ChangesPanelProps {
  port: number;
  projectId: string;
  chatId?: string;
}

export function ChangesPanel({ port, projectId, chatId }: ChangesPanelProps) {
  const [mode, setMode] = useState<ScopeMode>('uncommitted');
  const [files, setFiles] = useState<GitStatusFile[] | null>(null);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

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
  }, [port, projectId, chatId, refreshKey]);

  return (
    <div data-testid="changes-panel" className="flex flex-col">
      {/* Mode switcher */}
      <div className="flex-shrink-0 px-[8px] pt-[8px] pb-[6px]">
        <div className="flex h-[18px] items-center overflow-hidden rounded-[4px] bg-mf-chip">
          {SCOPE_MODES.map(({ id, label }) => (
            <button
              key={id}
              data-testid={`changes-mode-${id}`}
              type="button"
              onClick={() => setMode(id)}
              className={[
                'flex h-full flex-1 items-center justify-center text-micro transition-colors',
                id === mode
                  ? 'bg-mf-tab-active font-semibold text-foreground'
                  : 'font-medium text-mf-text-3 hover:text-foreground',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Header: count + refresh */}
      <div className="flex flex-shrink-0 items-center px-[8px] pb-[4px]">
        <span className="flex-1 font-mono text-micro text-mf-text-3">
          {files !== null ? `${files.length} changed files` : ''}
        </span>
        <button
          data-testid="changes-refresh"
          type="button"
          title="Refresh"
          onClick={() => setRefreshKey((k) => k + 1)}
          className="inline-flex h-[20px] w-[20px] flex-shrink-0 items-center justify-center rounded-[4px] border-none bg-transparent hover:bg-accent"
        >
          <RotateCw size={11} className="text-mf-text-3" />
        </button>
      </div>

      {/* File list */}
      {error && <div className="px-3 py-4 text-caption text-muted-foreground">Couldn't load changes.</div>}
      {!error && files === null && <div className="px-3 py-4 text-caption text-muted-foreground">Loading…</div>}
      {!error && files !== null && files.length === 0 && (
        <div className="px-3 py-4 text-caption text-muted-foreground">No changes.</div>
      )}
      {!error && files !== null && files.length > 0 && (
        <div className="py-1">
          {files.map((f) => (
            <button
              key={f.path}
              data-testid={`changes-row-${f.path}`}
              type="button"
              title={f.path}
              onClick={() => emitSurfaceIntent({ type: 'open-diff', path: f.path })}
              className="flex h-[22px] w-full items-center gap-2 border-none bg-transparent px-[6px] py-[4px] text-left hover:bg-accent hover:text-foreground"
            >
              <FileText size={10} className="flex-shrink-0 text-mf-text-3" />
              <span className="flex-1 truncate text-caption text-foreground">{basename(f.path)}</span>
              <span className="truncate font-mono text-micro text-muted-foreground">{dirname(f.path)}</span>
              <span
                data-testid={`changes-status-${f.path}`}
                className={`flex-shrink-0 font-bold text-micro [letter-spacing:0.3px] ${statusClass(f.status)}`}
              >
                {statusWord(f.status)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
