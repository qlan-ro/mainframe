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
  /** Absent for the `session` scope — the daemon reports paths only. */
  status?: ReviewFile['status'];
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

async function fetchUncommitted(port: number, projectId: string, chatId?: string): Promise<ChangesPayload> {
  const [statusFiles, stat, branchRes] = await Promise.all([
    getGitStatus(port, projectId, chatId),
    getWorkingStat(port, projectId, chatId).catch(() => undefined),
    getGitBranch(port, projectId, chatId).catch(() => ({ branch: null })),
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

async function fetchSession(port: number, chatId: string): Promise<ChangesPayload> {
  const files = await getSessionFiles(port, chatId);
  return { ...EMPTY, files: files.map((path) => ({ path })) };
}

async function fetchBranch(port: number, projectId: string, chatId?: string): Promise<ChangesPayload> {
  const data = await getBranchDiffs(port, projectId, chatId);
  return {
    files: data.files.map((file) => ({ path: file.path, status: gitStatusKind(file.status) })),
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
}: UseWorkingChangesOptions): WorkingChanges {
  const [payload, setPayload] = useState<ChangesPayload>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refetch = useCallback(() => setRefreshKey((key) => key + 1), []);

  // `session` resolves the worktree from the chat; the other two need a project.
  const canFetch = enabled && (scope === 'session' ? Boolean(chatId) : Boolean(projectId));

  useEffect(() => {
    if (!canFetch) {
      setPayload(EMPTY);
      setLoading(false);
      setError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    const request =
      scope === 'session'
        ? fetchSession(port, chatId!)
        : scope === 'branch'
          ? fetchBranch(port, projectId!, chatId)
          : fetchUncommitted(port, projectId!, chatId);
    request
      .then((next) => {
        if (cancelled) return;
        setPayload(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn('[use-working-changes] failed to load changes', scope, projectId, err);
        setPayload(EMPTY);
        setError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canFetch, port, projectId, chatId, scope, refreshKey]);

  // One invalidation policy for every consumer: the agent editing the tree, and
  // the user coming back to the window after editing it themselves.
  useEffect(() => {
    if (!canFetch) return;
    const off = daemonWs.onEvent((event) => {
      if (event.type !== 'context.updated') return;
      if (chatId && event.chatId !== chatId) return;
      refetch();
    });
    window.addEventListener('focus', refetch);
    return () => {
      off();
      window.removeEventListener('focus', refetch);
    };
  }, [canFetch, chatId, refetch]);

  return useMemo(() => ({ ...payload, loading, error, refetch }), [payload, loading, error, refetch]);
}
