import { useEffect, useMemo, useState } from 'react';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useFileSearch, dirOf } from '@/features/files/use-file-search';
import { getGitStatus, type GitStatusFile } from '@/lib/api/git';
import { gitStatusKind, KIND_LABEL } from '@/lib/git-status-kind';
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import { symbolKindLabel } from '@/lib/lsp/symbol-kind';
import type { ParsedQuery } from './palette-modes';
import { getPaletteCommands, filterCommands } from './palette-commands';
import { useWorkspaceSymbols } from './use-workspace-symbols';

export type RowType = 'session' | 'file' | 'command' | 'symbol' | 'change';

export interface SpotlightRow {
  type: RowType;
  /** Stable domain id (session id / path / command id / `${path}:${line}`). */
  id: string;
  testid: string;
  title: string;
  sub?: string;
  hint?: string;
  tag?: string;
  status?: string;
  run: () => void;
}

interface Args {
  parsed: ParsedQuery;
  port: number;
  projectId?: string;
  projectPath?: string;
  chatId?: string;
  sessions: SessionItem[];
  switchToThread: (id: string) => void;
}

/** Working-tree changes, fetched only while in `chg` mode. */
function useGitChanges(
  port: number,
  projectId: string | undefined,
  chatId: string | undefined,
  enabled: boolean,
): { files: GitStatusFile[]; loading: boolean } {
  const [files, setFiles] = useState<GitStatusFile[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled || !projectId) {
      setFiles([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getGitStatus(port, projectId, chatId)
      .then((f) => {
        if (!cancelled) setFiles(f);
      })
      .catch((err) => {
        console.warn('[use-spotlight-results] getGitStatus failed', err);
        if (!cancelled) setFiles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, port, projectId, chatId]);
  return { files, loading };
}

function commandRows(term: string): SpotlightRow[] {
  return filterCommands(getPaletteCommands(), term).map((c) => ({
    type: 'command' as const,
    id: c.id,
    testid: `search-palette-command-row-${c.id}`,
    title: c.label,
    hint: c.hint,
    run: c.run,
  }));
}

function symbolRows(symbols: ReturnType<typeof useWorkspaceSymbols>['symbols']): SpotlightRow[] {
  return symbols.map((s) => ({
    type: 'symbol' as const,
    id: `${s.path}:${s.line}`,
    testid: `search-palette-symbol-row-${s.path}:${s.line}`,
    title: s.name,
    sub: s.path,
    tag: symbolKindLabel(s.kind),
    run: () => emitSurfaceIntent({ type: 'open-file', path: s.path, line: s.line, character: 0 }),
  }));
}

function changeRows(changes: GitStatusFile[], term: string): SpotlightRow[] {
  const t = term.toLowerCase();
  return changes
    .filter((f) => !t || f.path.toLowerCase().includes(t))
    .map((f) => ({
      type: 'change' as const,
      id: f.path,
      testid: `search-palette-change-row-${f.path}`,
      title: f.path.split('/').pop() ?? f.path,
      sub: dirOf(f.path),
      status: KIND_LABEL[gitStatusKind(f.status)],
      run: () => emitSurfaceIntent({ type: 'open-diff', path: f.path }),
    }));
}

function fileModeRows(
  sessions: SessionItem[],
  files: ReturnType<typeof useFileSearch>['results'],
  term: string,
  switchToThread: (id: string) => void,
): SpotlightRow[] {
  const t = term.toLowerCase();
  const cap = term ? 10 : 5;
  const sessionRows: SpotlightRow[] = sessions
    .filter((s) => (s.title ?? 'Untitled').toLowerCase().includes(t))
    .slice(0, cap)
    .map((s) => {
      const targetId = s.remoteId ?? s.id;
      return {
        type: 'session' as const,
        id: targetId,
        testid: `search-palette-session-row-${targetId}`,
        title: s.title ?? 'Untitled',
        run: () => {
          switchToThread(targetId);
          emitSurfaceIntent({ type: 'activate-surface', surface: 'chat' });
        },
      };
    });
  const fileRows: SpotlightRow[] = files.map((r) => ({
    type: 'file' as const,
    id: r.path,
    testid: `search-palette-file-row-${r.path}`,
    title: r.name,
    sub: dirOf(r.path),
    run: () => emitSurfaceIntent({ type: 'open-file', path: r.path }),
  }));
  return [...sessionRows, ...fileRows];
}

export function useSpotlightResults({
  parsed,
  port,
  projectId,
  projectPath,
  chatId,
  sessions,
  switchToThread,
}: Args): { rows: SpotlightRow[]; loading: boolean } {
  const { mode, term } = parsed;

  // All data hooks are called unconditionally; fetching is gated by mode/enabled.
  const fileSearch = useFileSearch(port, projectId, chatId, mode === 'file' ? term : '', 2);
  const symbolSearch = useWorkspaceSymbols({
    port,
    projectId,
    projectPath,
    chatId,
    term,
    enabled: mode === 'sym',
  });
  const { files: changes, loading: changesLoading } = useGitChanges(port, projectId, chatId, mode === 'chg');

  const rows = useMemo<SpotlightRow[]>(() => {
    if (mode === 'cmd') return commandRows(term);
    if (mode === 'sym') return symbolRows(symbolSearch.symbols);
    if (mode === 'chg') return changeRows(changes, term);
    return fileModeRows(sessions, fileSearch.results, term, switchToThread);
  }, [mode, term, sessions, fileSearch.results, symbolSearch.symbols, changes, switchToThread]);

  const loading = (mode === 'file' && fileSearch.loading) || (mode === 'sym' && symbolSearch.loading) || (mode === 'chg' && changesLoading);
  return { rows, loading };
}
