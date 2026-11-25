/**
 * use-working-changes — the one hook every change surface reads.
 *
 * The review modal, the session panel's Changes row and the change-scope
 * switcher all want the same thing at different fidelities, and used to fetch it
 * three ways with three staleness stories. This owns the fetches, the merge, and
 * a single invalidation policy (`context.updated` for the active chat, plus
 * window focus), gated by `enabled` so a closed modal still fetches nothing.
 *
 * Scopes report different fidelities and the shape says so: where the daemon has
 * no counts or no per-file status, the field is `undefined`. A fabricated `0`
 * would read as "no changes", which is a different claim.
 *
 * `session` is every file the session wrote or edited, committed or not, read
 * from its transcript; its diffs replay the session's own edits (see
 * `getSessionDiff`) rather than reading git.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBranchDiffs, getGitBranch, getGitStatus, getWorkingStat } from '@/lib/api/git';
import { getSessionFiles } from '@/lib/api/files';
import { gitStatusKind } from '@/lib/git-status-kind';
import { daemonWs } from '@/lib/daemon/ws-client';
import { gitStatusToFiles, type ReviewFile } from './git-status-to-files';

export type ChangeScope = 'session' | 'uncommitted' | 'branch';

export interface WorkingChangeFile {
  path: string;
  status?: ReviewFile['status'];
  /** Source path of a rename — where the diff reads the original from. */
  oldPath?: string;
  /** Absent for scopes with no per-file stat (`session`, `branch`). */
  additions?: number;
  deletions?: number;
}

interface ChangesPayload {
  files: WorkingChangeFile[];
  totalAdditions?: number;
  totalDeletions?: number;
  branch: string | null;
  /** `branch` scope only — the comparison line's other half. */
  baseBranch: string | null;
  mergeBase: string | null;
}

export interface WorkingChanges extends ChangesPayload {
  loading: boolean;
  error: boolean;
  refetch: () => void;
}

export interface UseWorkingChangesOptions {
  port: number;
  projectId: string | null | undefined;
  chatId?: string;
  /** Defaults to `uncommitted` — the scope every existing consumer wanted. */
  scope?: ChangeScope;
  /** Defaults to true; the review modal only fetches while it is open. */
  enabled?: boolean;
  /**
   * A non-project chat has no git repo and no session-file cwd worth reading
   * (todo #346) — set from `useActiveIdentity().noProject`. Blocks every scope.
   */
  noProject?: boolean;
  /** Defaults to true. A surface that names the branch from another source skips the extra git read. */
  withBranch?: boolean;
}

export interface ChangesSummary {
  fileCount: number;
  additions?: number;
  deletions?: number;
}

const EMPTY: ChangesPayload = { files: [], branch: null, baseBranch: null, mergeBase: null };

/** The session panel's Changes row — a count, not a file list. */
export function toChangesSummary(
  changes: Pick<WorkingChanges, 'files' | 'totalAdditions' | 'totalDeletions'>,
): ChangesSummary {
  return {
    fileCount: changes.files.length,
    additions: changes.totalAdditions,
    deletions: changes.totalDeletions,
  };
}

async function fetchUncommitted(
  port: number,
  projectId: string,
  chatId: string | undefined,
  withBranch: boolean,
): Promise<ChangesPayload> {
  const [statusFiles, stat, branchRes] = await Promise.all([
    getGitStatus(port, projectId, chatId),
    getWorkingStat(port, projectId, chatId).catch(() => undefined),
    withBranch ? getGitBranch(port, projectId, chatId).catch(() => ({ branch: null })) : { branch: null },
  ]);
  return {
    files: gitStatusToFiles(statusFiles, stat),
    totalAdditions: stat?.totalAdditions,
    totalDeletions: stat?.totalDeletions,
    branch: branchRes.branch,
    baseBranch: null,
    mergeBase: null,
  };
}

async function fetchSession(port: number, projectId: string, chatId: string): Promise<ChangesPayload> {
  const [files, branchRes] = await Promise.all([
    getSessionFiles(port, chatId),
    getGitBranch(port, projectId, chatId).catch(() => ({ branch: null })),
  ]);
  return { ...EMPTY, files, branch: branchRes.branch };
}

async function fetchBranch(port: number, projectId: string, chatId?: string): Promise<ChangesPayload> {
  const data = await getBranchDiffs(port, projectId, chatId);
  return {
    files: data.files.map((file) => ({
      path: file.path,
      status: gitStatusKind(file.status),
      ...(file.oldPath ? { oldPath: file.oldPath } : {}),
    })),
    branch: data.branch,
    baseBranch: data.baseBranch,
    mergeBase: data.mergeBase,
  };
}

export function useWorkingChanges({
  port,
  projectId,
  chatId,
  scope = 'uncommitted',
  enabled = true,
  noProject = false,
  withBranch = true,
}: UseWorkingChangesOptions): WorkingChanges {
  // Tagged with the scope it was fetched for: right after a scope switch the
  // previous scope's files must not be read as the new scope's.
  const [loaded, setLoaded] = useState<{ scope: ChangeScope; payload: ChangesPayload }>({ scope, payload: EMPTY });
  const payload = loaded.scope === scope ? loaded.payload : EMPTY;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refetch = useCallback(() => setRefreshKey((key) => key + 1), []);

  // Every scope reads git through the project; `session` also needs the chat.
  const canFetch = enabled && !noProject && Boolean(projectId) && (scope !== 'session' || Boolean(chatId));

  useEffect(() => {
    if (!canFetch) {
      setLoaded({ scope, payload: EMPTY });
      setLoading(false);
      setError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    const request =
      scope === 'session'
        ? fetchSession(port, projectId!, chatId!)
        : scope === 'branch'
          ? fetchBranch(port, projectId!, chatId)
          : fetchUncommitted(port, projectId!, chatId, withBranch);
    request
      .then((next) => {
        if (cancelled) return;
        setLoaded({ scope, payload: next });
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn('[use-working-changes] failed to load changes', scope, projectId, err);
        setLoaded({ scope, payload: EMPTY });
        setError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canFetch, port, projectId, chatId, scope, withBranch, refreshKey]);

  // One invalidation policy for every consumer: the agent editing the tree, and
  // the user coming back to the window after editing it themselves. An edit made
  // while nobody can see the window waits until somebody can.
  useEffect(() => {
    if (!canFetch) return;
    let missed = false;
    const off = daemonWs.onEvent((event) => {
      if (event.type !== 'context.updated') return;
      if (chatId && event.chatId !== chatId) return;
      if (document.hidden) missed = true;
      else refetch();
    });
    const onVisible = () => {
      if (document.hidden || !missed) return;
      missed = false;
      refetch();
    };
    window.addEventListener('focus', refetch);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      off();
      window.removeEventListener('focus', refetch);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [canFetch, chatId, refetch]);

  return useMemo(() => ({ ...payload, loading, error, refetch }), [payload, loading, error, refetch]);
}
