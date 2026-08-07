/**
 * use-display-branch — the branch name a session-scoped surface should show.
 *
 * The persisted `chat.branchName` is set only for worktree sessions, so a
 * main-repo session has no branch at all without a live `getGitBranch` read.
 * Both the shell toolbar's chip and the session panel's Summary row want that
 * same answer, so the rule lives here once rather than being copied.
 *
 * `refetch` exists because a branch-popover write (checkout, rename) broadcasts
 * no `chat.updated`, so nothing else would invalidate the live read.
 */
import { useCallback, useEffect, useState } from 'react';
import { getGitBranch } from '@/lib/api/git';

export interface UseDisplayBranchOptions {
  port: number;
  projectId?: string;
  chatId?: string;
  /** The session's persisted branch — present for worktree sessions only. */
  branchName?: string;
  isWorktree?: boolean;
}

export interface DisplayBranch {
  branch: string | undefined;
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
}: UseDisplayBranchOptions): DisplayBranch {
  const [liveBranch, setLiveBranch] = useState<string | undefined>(undefined);

  useEffect(() => {
    setLiveBranch(undefined);
    if (!projectId) return;
    let cancelled = false;
    getGitBranch(port, projectId, chatId)
      .then(({ branch }) => {
        if (!cancelled) setLiveBranch(branch ?? undefined);
      })
      .catch((err: unknown) => {
        if (!cancelled) console.warn('[use-display-branch] failed to read current branch', err);
      });
    return () => {
      cancelled = true;
    };
  }, [port, projectId, chatId, branchName]);

  const refetch = useCallback(() => {
    if (!projectId) return;
    getGitBranch(port, projectId, chatId)
      .then(({ branch }) => setLiveBranch(branch ?? undefined))
      .catch((err: unknown) => {
        console.warn('[use-display-branch] failed to refresh branch after a write', err);
      });
  }, [port, projectId, chatId]);

  // A worktree DRAFT (chat created on first send) can't resolve its branch live:
  // without a chatId the fetch reads the project root. Trust the draft's own
  // name there; every other state prefers the live read.
  const isDraftWorktree = isWorktree && !chatId;
  const branch = isDraftWorktree ? (branchName ?? liveBranch) : (liveBranch ?? branchName);

  return { branch, isDraftWorktree, refetch };
}
