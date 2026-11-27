import { useCallback, useEffect, useMemo, useState } from 'react';
import { getGitBranch } from '@/lib/api/git';
import { useAfterFirstPaint } from '@/lib/after-first-paint';

export interface UseDisplayBranchOptions {
  port: number;
  projectId?: string;
  chatId?: string;
  /** The session's persisted branch — present for worktree sessions only. */
  branchName?: string;
  isWorktree?: boolean;
  worktreePath?: string;
  hasRecordedBase?: boolean;
  visible?: boolean;
  /** A non-project chat has no git repo to read a branch from (todo #346). */
  noProject?: boolean;
}

export interface DisplayBranch {
  branch: string | undefined;
  liveBranch: string | null | undefined;
  /** A worktree draft: no chat exists yet, so a live read would answer for the project ROOT. */
  isDraftWorktree: boolean;
  refetch: () => void;
}

export function useDisplayBranch({
  port,
  projectId,
  chatId,
  branchName,
  isWorktree = false,
  noProject = false,
  worktreePath,
  hasRecordedBase = false,
  visible = true,
}: UseDisplayBranchOptions): DisplayBranch {
  const painted = useAfterFirstPaint();
  const canRead = painted && (!hasRecordedBase || visible);
  const boundPath = hasRecordedBase ? worktreePath : undefined;
  const [revision, setRevision] = useState(0);
  const request = useMemo(
    () => ({ port, projectId, chatId, branchName, noProject, boundPath, revision, canRead }),
    [port, projectId, chatId, branchName, noProject, boundPath, revision, canRead],
  );
  const [live, setLive] = useState<{ request: typeof request; branch: string | null }>();
  const liveBranch = live?.request === request ? live.branch : undefined;
  const refetch = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const { port, projectId, chatId, noProject, canRead } = request;
    if (!canRead || !projectId || noProject) return;
    let cancelled = false;
    getGitBranch(port, projectId, chatId)
      .then(({ branch }) => {
        if (!cancelled) setLive({ request, branch });
      })
      .catch((err: unknown) => {
        if (!cancelled) console.warn('[use-display-branch] failed to read current branch', err);
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  useEffect(() => {
    if (!hasRecordedBase || !visible) return;
    window.addEventListener('focus', refetch);
    return () => window.removeEventListener('focus', refetch);
  }, [hasRecordedBase, visible, refetch]);

  // A worktree DRAFT (chat created on first send) can't resolve its branch live:
  // without a chatId the fetch reads the project root. Trust the draft's own
  // name there; every other state prefers the live read.
  const isDraftWorktree = isWorktree && !chatId;
  const branch = isDraftWorktree ? (branchName ?? liveBranch ?? undefined) : (liveBranch ?? branchName);

  return { branch, liveBranch, isDraftWorktree, refetch };
}
