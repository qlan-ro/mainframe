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
  watchWorktreePath?: string;
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
  watchWorktreePath,
}: UseDisplayBranchOptions): DisplayBranch {
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([port, projectId, chatId, branchName, noProject, watchWorktreePath, revision]);
  const [live, setLive] = useState<{ key: string; branch: string | null }>();
  const liveBranch = live?.key === key ? live.branch : undefined;
  const refetch = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!projectId || noProject) return;
    let cancelled = false;
    let pending = false;
    const read = async () => {
      if (pending) return;
      pending = true;
      try {
        const { branch } = await getGitBranch(port, projectId, chatId);
        if (!cancelled) setLive({ key, branch });
      } catch (err: unknown) {
        if (!cancelled) {
          setLive(undefined);
          console.warn('[use-display-branch] failed to read current branch', err);
        }
      } finally {
        pending = false;
      }
    };
    void read();
    const timer =
      watchWorktreePath &&
      window.setInterval(() => {
        if (!document.hidden) void read();
      }, 5000);
    if (watchWorktreePath) window.addEventListener('focus', refetch);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      window.removeEventListener('focus', refetch);
    };
  }, [port, projectId, chatId, noProject, key, watchWorktreePath, refetch]);

  // A worktree DRAFT (chat created on first send) can't resolve its branch live:
  // without a chatId the fetch reads the project root. Trust the draft's own
  // name there; every other state prefers the live read.
  const isDraftWorktree = isWorktree && !chatId;
  const branch = isDraftWorktree ? (branchName ?? liveBranch ?? undefined) : (liveBranch ?? branchName);

  return { branch, liveBranch, isDraftWorktree, refetch };
}
