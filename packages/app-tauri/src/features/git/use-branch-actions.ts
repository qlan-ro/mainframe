/**
 * useBranchActions — server-authoritative per-action handlers for the git
 * branch popover.  All actions go through `withBusy` (from use-branch-busy)
 * so the UI gets a loading state and toast-errors automatically.
 *
 * handleNewSession is NOT here — it needs the sessions runtime (Task B7).
 * handleDelete is a TWO-step confirm: initial "Delete?" then, if the first
 * attempt returns "not-merged", a second "Force delete?" before retrying.
 * handleDeleteWorktree lives in use-worktree-actions to keep this file < 300 lines.
 */
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import type { BranchListResult } from '@qlan-ro/mainframe-types';
import {
  getGitBranches,
  getGitStatus,
  gitCheckout,
  gitCreateBranch,
  gitFetch,
  gitPull,
  gitPush,
  gitMerge,
  gitRebase,
  gitAbort,
  gitRenameBranch,
  gitDeleteBranch,
  gitUpdateAll,
} from '@/lib/api/git';
import type { GitStatusFile } from '@/lib/api/git';
import { useBranchBusy } from './use-branch-busy';
import { requestGitConfirm } from './use-git-confirm';
import { useWorktreeActions } from './use-worktree-actions';

const CONFLICT_STATUSES = new Set(['UU', 'AA', 'DD', 'AU', 'UA', 'UD', 'DU']);

function isConflictStatus(status: string): boolean {
  return CONFLICT_STATUSES.has(status);
}

export interface BranchActionsProps {
  port: number;
  projectId: string;
  chatId?: string;
}

export interface BranchActions {
  branches: BranchListResult | null;
  conflictFiles: GitStatusFile[];
  busy: boolean;
  busyAction: string | null;
  loadBranches: () => Promise<void>;
  handleCheckout: (branch: string) => Promise<boolean>;
  handlePull: (branch: string) => Promise<boolean>;
  handlePush: (branch: string) => Promise<boolean>;
  handleMerge: (branch: string) => Promise<boolean>;
  handleRebase: (branch: string) => Promise<boolean>;
  handleRename: (oldName: string, newName: string) => Promise<boolean>;
  handleDelete: (branch: string, isRemote?: boolean) => Promise<boolean>;
  handleDeleteWorktree: (worktreeDirName: string, branchName: string | undefined) => Promise<boolean>;
  handleFetch: () => Promise<boolean>;
  handleUpdateAll: () => Promise<boolean>;
  handleAbort: () => Promise<boolean>;
  handleCreateBranch: (name: string, startPoint: string) => Promise<boolean>;
}

export function useBranchActions({ port, projectId, chatId }: BranchActionsProps): BranchActions {
  const [branches, setBranches] = useState<BranchListResult | null>(null);
  const [conflictFiles, setConflictFiles] = useState<GitStatusFile[]>([]);
  const { busy, busyAction, withBusy } = useBranchBusy();

  const loadBranches = useCallback(async () => {
    try {
      const [branchData, statusData] = await Promise.all([
        getGitBranches(port, projectId, chatId),
        getGitStatus(port, projectId, chatId),
      ]);
      setBranches(branchData);
      setConflictFiles(statusData.filter((f) => isConflictStatus(f.status)));
    } catch (err) {
      console.warn('[useBranchActions] loadBranches failed', err);
      toast.error('Failed to load branches');
    }
  }, [port, projectId, chatId]);

  // loadBranches is NOT called automatically on mount — the BranchPopover gates
  // it behind the `open` state so closed popovers never fire git fetches.

  const { handleDeleteWorktree } = useWorktreeActions({ port, projectId, loadBranches, withBusy });

  const confirmDirtyTree = useCallback(async (): Promise<boolean> => {
    const files = await getGitStatus(port, projectId, chatId);
    if (files.length === 0) return true;
    return requestGitConfirm({
      title: 'Uncommitted changes',
      body: 'You have uncommitted changes. Continue?',
      confirmLabel: 'Continue',
    });
  }, [port, projectId, chatId]);

  const handleCheckout = useCallback(
    async (branch: string) =>
      withBusy(async () => {
        if (!(await confirmDirtyTree())) return;
        await gitCheckout(port, projectId, branch, chatId);
        toast.success(`Switched to ${branch}`);
        await loadBranches();
      }),
    [port, projectId, chatId, confirmDirtyTree, loadBranches, withBusy],
  );

  const handlePull = useCallback(
    async (branch: string) =>
      withBusy(async () => {
        const info = branches?.local.find((b) => b.name === branch);
        const slashIdx = info?.tracking?.indexOf('/') ?? -1;
        const remote = slashIdx > 0 ? info!.tracking!.slice(0, slashIdx) : undefined;
        const remoteBranch = slashIdx > 0 ? info!.tracking!.slice(slashIdx + 1) : undefined;
        if (!remote || !remoteBranch) {
          toast.error(`No tracking remote for ${branch}`);
          return;
        }
        const result = await gitPull(port, projectId, { remote, branch: remoteBranch, localBranch: branch, chatId });
        if (result.status === 'conflict') {
          toast.error('Pull resulted in conflicts');
        } else if (result.status === 'up-to-date') {
          toast.info('Already up to date');
        } else {
          const { changes } = result.summary;
          toast.success(changes > 0 ? `Pulled ${changes} changes` : `Updated ${branch}`);
        }
        await loadBranches();
      }),
    [port, projectId, chatId, branches, loadBranches, withBusy],
  );

  const handlePush = useCallback(
    async (branch: string) =>
      withBusy(async () => {
        const info = branches?.local.find((b) => b.name === branch);
        const slashIdx = info?.tracking?.indexOf('/') ?? -1;
        const remote = slashIdx > 0 ? info!.tracking!.slice(0, slashIdx) : undefined;
        const result = await gitPush(port, projectId, { branch, remote, chatId });
        if (result.status === 'rejected') {
          toast.error(`Push rejected: ${result.message}`);
        } else {
          toast.success(`Pushed to ${result.remote}/${result.branch}`);
        }
      }),
    [port, projectId, chatId, branches, withBusy],
  );

  const handleMerge = useCallback(
    async (branch: string) =>
      withBusy(async () => {
        if (!(await confirmDirtyTree())) return;
        const result = await gitMerge(port, projectId, branch, chatId);
        if (result.status !== 'conflict') {
          const { insertions, deletions } = result.summary;
          const detail = insertions || deletions ? `+${insertions} -${deletions}` : undefined;
          toast.success(`Merged ${branch}${detail ? ` (${detail})` : ''}`);
        }
        await loadBranches();
      }),
    [port, projectId, chatId, confirmDirtyTree, loadBranches, withBusy],
  );

  const handleRebase = useCallback(
    async (branch: string) =>
      withBusy(async () => {
        if (!(await confirmDirtyTree())) return;
        const result = await gitRebase(port, projectId, branch, chatId);
        if (result.status !== 'conflict') {
          toast.success('Rebase complete');
        }
        await loadBranches();
      }),
    [port, projectId, chatId, confirmDirtyTree, loadBranches, withBusy],
  );

  const handleRename = useCallback(
    async (oldName: string, newName: string) =>
      withBusy(async () => {
        await gitRenameBranch(port, projectId, oldName, newName, chatId);
        toast.success(`Renamed to ${newName}`);
        await loadBranches();
      }),
    [port, projectId, chatId, loadBranches, withBusy],
  );

  const handleDelete = useCallback(
    async (branch: string, isRemote?: boolean): Promise<boolean> => {
      const label = isRemote ? `remote branch '${branch}'` : `branch '${branch}'`;
      const confirmed = await requestGitConfirm({
        title: `Delete ${label}?`,
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!confirmed) return false;
      return withBusy(async () => {
        const result = await gitDeleteBranch(port, projectId, branch, { remote: isRemote, chatId });
        if (result.status === 'is-current') {
          toast.error(result.message);
          return;
        }
        if (result.status === 'not-merged') {
          const force = await requestGitConfirm({
            title: `Force delete ${label}?`,
            body: result.message,
            confirmLabel: 'Force delete',
            destructive: true,
          });
          if (!force) return;
          await gitDeleteBranch(port, projectId, branch, { force: true, remote: isRemote, chatId });
          toast.success(`Deleted ${label}`);
        } else {
          toast.success(`Deleted ${label}`);
        }
        await loadBranches();
      });
    },
    [port, projectId, chatId, loadBranches, withBusy],
  );

  const handleFetch = useCallback(
    async () =>
      withBusy(async () => {
        await gitFetch(port, projectId, undefined, chatId);
        toast.success('Fetched');
        await loadBranches();
      }, 'fetch'),
    [port, projectId, chatId, loadBranches, withBusy],
  );

  const handleUpdateAll = useCallback(
    async () =>
      withBusy(async () => {
        const result = await gitUpdateAll(port, projectId, chatId);
        const updated = result.branches.filter((b) => b.status === 'updated').length;
        if (result.pull.status === 'conflict') {
          toast.error('Conflicts during update');
        } else {
          const parts: string[] = [];
          if (result.pull.status === 'success') parts.push('current branch pulled');
          if (updated > 0) parts.push(`${updated} branches updated`);
          toast.success(parts.length > 0 ? parts.join(', ') : 'All up to date');
        }
        await loadBranches();
      }, 'updateAll'),
    [port, projectId, chatId, loadBranches, withBusy],
  );

  const handleAbort = useCallback(
    async () =>
      withBusy(async () => {
        await gitAbort(port, projectId, chatId);
        toast.success('Aborted');
        await loadBranches();
      }),
    [port, projectId, chatId, loadBranches, withBusy],
  );

  const handleCreateBranch = useCallback(
    async (name: string, startPoint: string) =>
      withBusy(async () => {
        await gitCreateBranch(port, projectId, name, startPoint, chatId);
        toast.success(`Created ${name}`);
        await loadBranches();
      }),
    [port, projectId, chatId, loadBranches, withBusy],
  );

  return {
    branches,
    conflictFiles,
    busy,
    busyAction,
    loadBranches,
    handleCheckout,
    handlePull,
    handlePush,
    handleMerge,
    handleRebase,
    handleRename,
    handleDelete,
    handleDeleteWorktree,
    handleFetch,
    handleUpdateAll,
    handleAbort,
    handleCreateBranch,
  };
}
