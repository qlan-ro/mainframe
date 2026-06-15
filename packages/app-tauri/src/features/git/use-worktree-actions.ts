/**
 * Worktree action handlers extracted from useBranchActions to keep files
 * under the 300-line limit.  Composed back in via useBranchActions.
 *
 * handleNewSession is NOT here — it needs the sessions runtime (Task B7).
 */
import { useCallback } from 'react';
import { toast } from 'sonner';
import { getProjectWorktrees, deleteWorktree } from '@/lib/api/git';
import { requestGitConfirm } from './use-git-confirm';
import type { BranchBusy } from './use-branch-busy';

export interface WorktreeActionsProps {
  port: number;
  projectId: string;
  loadBranches: () => Promise<void>;
  withBusy: BranchBusy['withBusy'];
}

export interface WorktreeActions {
  handleDeleteWorktree: (worktreeDirName: string, branchName: string | undefined) => Promise<boolean>;
}

export function useWorktreeActions({ port, projectId, loadBranches, withBusy }: WorktreeActionsProps): WorktreeActions {
  const handleDeleteWorktree = useCallback(
    async (worktreeDirName: string, branchName: string | undefined): Promise<boolean> => {
      const label = branchName
        ? `worktree '${worktreeDirName}' (branch: ${branchName})`
        : `worktree '${worktreeDirName}'`;
      const confirmed = await requestGitConfirm({
        title: `Delete ${label}?`,
        body: 'This cannot be undone.',
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!confirmed) return false;
      return withBusy(async () => {
        const worktrees = await getProjectWorktrees(port, projectId);
        const match = worktrees.find((wt) => wt.path.endsWith(`/${worktreeDirName}`) || wt.path === worktreeDirName);
        if (!match) {
          toast.error(`Could not resolve path for worktree '${worktreeDirName}'`);
          return;
        }
        await deleteWorktree(port, projectId, match.path, branchName);
        toast.success(`Deleted ${label}`);
        await loadBranches();
      }, `deleteWorktree:${worktreeDirName}`);
    },
    [port, projectId, loadBranches, withBusy],
  );

  return { handleDeleteWorktree };
}
