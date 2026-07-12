/**
 * ChangesPanel — the Inspector's Changes tab. Three scopes, each backed by a
 * distinct daemon source (parity with the desktop ChangesTab):
 *   - Session     → files the agent touched this session (`getSessionFiles`)
 *   - Uncommitted → working-tree git status (`getGitStatus`)
 *   - Branch      → branch-vs-base diff (`getBranchDiffs`, with a comparing line)
 * Clicking a row opens a HEAD-vs-working diff tab (via the open-diff intent).
 * Auto-refreshes on the daemon's `context.updated` event and on window focus.
 */
import { useCallback, useEffect, useState } from 'react';
import { File, RotateCw } from 'lucide-react';
import { getGitStatus, getBranchDiffs } from '@/lib/api/git';
import { getSessionFiles } from '@/lib/api/files';
import { gitStatusKind } from '@/lib/git-status-kind';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { daemonWs } from '@/lib/daemon/ws-client';
import { TruncatedWithTooltip } from '@/components/ui/truncated-with-tooltip';
import { Hint } from '@/components/ui/hint';

type ScopeMode = 'session' | 'uncommitted' | 'branch';

interface ChangeRow {
  path: string;
  /** Porcelain code; absent for session rows (which carry no per-file status). */
  status?: string;
}

interface BranchMeta {
  branch: string | null;
  baseBranch: string | null;
}

const SCOPE_MODES: { id: ScopeMode; label: string }[] = [
  { id: 'session', label: 'Session' },
  { id: 'uncommitted', label: 'Uncommitted' },
  { id: 'branch', label: 'Branch' },
];

const SCOPE_BTN = 'flex h-[18px] flex-1 items-center justify-center rounded-[4px] text-label transition-colors';

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
  modified: 'text-muted-foreground',
  renamed: 'text-muted-foreground',
};

const statusClass = (code: string): string => KIND_CLASS[gitStatusKind(code)] ?? 'text-muted-foreground';
const statusWord = (code: string): string => KIND_WORD[gitStatusKind(code)] ?? 'Modified';
const basename = (path: string): string =>
  path.lastIndexOf('/') === -1 ? path : path.slice(path.lastIndexOf('/') + 1);
const dirname = (path: string): string => (path.lastIndexOf('/') === -1 ? '.' : path.slice(0, path.lastIndexOf('/')));

interface FetchResult {
  rows: ChangeRow[];
  branch: BranchMeta | null;
}

/** Load the row set + branch metadata for a scope. Throws on transport error. */
async function fetchChanges(
  port: number,
  projectId: string,
  chatId: string | undefined,
  mode: ScopeMode,
): Promise<FetchResult> {
  if (mode === 'session') {
    if (!chatId) return { rows: [], branch: null };
    const files = await getSessionFiles(port, chatId);
    return { rows: files.map((path) => ({ path })), branch: null };
  }
  if (mode === 'branch') {
    const data = await getBranchDiffs(port, projectId, chatId);
    return {
      rows: data.files.map((f) => ({ path: f.path, status: f.status })),
      branch: { branch: data.branch, baseBranch: data.baseBranch },
    };
  }
  const files = await getGitStatus(port, projectId, chatId);
  return { rows: files.map((f) => ({ path: f.path, status: f.status })), branch: null };
}

interface ChangesPanelProps {
  port: number;
  projectId: string;
  chatId?: string;
}

export function ChangesPanel({ port, projectId, chatId }: ChangesPanelProps) {
  const [mode, setMode] = useState<ScopeMode>('uncommitted');
  const [rows, setRows] = useState<ChangeRow[] | null>(null);
  const [branch, setBranch] = useState<BranchMeta | null>(null);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(false);
    fetchChanges(port, projectId, chatId, mode)
      .then((res) => {
        if (cancelled) return;
        setRows(res.rows);
        setBranch(res.branch);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn('[ChangesPanel] failed to load changes', projectId, mode, err);
        setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [port, projectId, chatId, mode, refreshKey]);

  // Live-refresh as the agent edits the tree, and when the window regains focus.
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);
  useEffect(() => {
    const off = daemonWs.onEvent((event) => {
      if (event.type !== 'context.updated') return;
      if (mode === 'session' && event.chatId !== chatId) return;
      bump();
    });
    window.addEventListener('focus', bump);
    return () => {
      off();
      window.removeEventListener('focus', bump);
    };
  }, [mode, chatId, bump]);

  const sessionNoChat = mode === 'session' && !chatId;

  return (
    <div data-testid="changes-panel" className="flex flex-col">
      {/* Scope switcher + refresh (one row, per artboard) */}
      <div className="flex flex-shrink-0 items-center gap-[5px] px-[12px] pt-[4px] pb-[8px]">
        <div className="flex flex-1 items-center gap-0.5 rounded-[6px] bg-mf-chip p-0.5">
          {SCOPE_MODES.map(({ id, label }) => (
            <button
              key={id}
              data-testid={`changes-mode-${id}`}
              type="button"
              onClick={() => setMode(id)}
              aria-pressed={id === mode}
              className={`${SCOPE_BTN} ${
                id === mode
                  ? 'bg-mf-tab-active font-semibold text-foreground shadow-[var(--mf-shadow-rail-active)]'
                  : 'font-medium text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <Hint label="Refresh">
          <button
            data-testid="changes-refresh"
            type="button"
            onClick={bump}
            className="inline-flex h-[20px] w-[20px] flex-shrink-0 items-center justify-center rounded-[4px] border-none bg-transparent hover:bg-accent"
          >
            <RotateCw size={14} className="text-muted-foreground" />
          </button>
        </Hint>
      </div>

      {/* Count + (branch comparison, right-aligned) */}
      <div className="flex flex-shrink-0 items-center gap-[6px] px-[12px] pb-[6px]">
        <span className="text-caption text-muted-foreground">
          {rows !== null && !sessionNoChat ? `${rows.length} changed ${rows.length === 1 ? 'file' : 'files'}` : ''}
        </span>
        <div className="flex-1" />
        {mode === 'branch' && branch?.branch && branch?.baseBranch && (
          <span className="truncate font-mono text-caption text-primary">
            {branch.branch} ↔ {branch.baseBranch}
          </span>
        )}
      </div>

      {/* Body */}
      {sessionNoChat && (
        <div className="px-3 py-4 text-caption text-muted-foreground">Open a session to view its changes.</div>
      )}
      {error && <div className="px-3 py-4 text-caption text-muted-foreground">Couldn't load changes.</div>}
      {!error && !sessionNoChat && rows === null && (
        <div className="px-3 py-4 text-caption text-muted-foreground">Loading…</div>
      )}
      {!error && !sessionNoChat && rows !== null && rows.length === 0 && (
        <div className="px-3 py-4 text-caption text-muted-foreground">No changes.</div>
      )}
      {!error && !sessionNoChat && rows !== null && rows.length > 0 && (
        <div className="px-[6px] pb-[6px]">
          {rows.map((f) => (
            <button
              key={f.path}
              data-testid={`changes-row-${f.path}`}
              type="button"
              onClick={() => emitSurfaceIntent({ type: 'open-diff', path: f.path })}
              className="flex h-[22px] w-full items-center gap-[7px] rounded-[4px] border-none bg-transparent px-[6px] py-[4px] text-left hover:bg-accent hover:text-foreground"
            >
              <File size={12} className="flex-shrink-0 text-mf-text-3" />
              <TruncatedWithTooltip
                text={basename(f.path)}
                tooltip={f.path}
                className="flex-1 text-label text-foreground"
                contentClassName="font-mono break-all"
              />
              <span className="truncate font-mono text-caption text-muted-foreground">{dirname(f.path)}</span>
              {f.status && (
                <span
                  data-testid={`changes-status-${f.path}`}
                  className={`flex-shrink-0 font-medium text-caption ${statusClass(f.status)}`}
                >
                  {statusWord(f.status)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
