import { useCallback, useEffect, useState } from 'react';
import type { BranchInfo } from '@qlan-ro/mainframe-types';
import { toast } from '../../lib/toast';
import { isConflictStatus } from '../../lib/git-utils';
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
} from '../../lib/api';

interface BranchData {
  current: string;
  local: BranchInfo[];
  remote: string[];
  worktrees: string[];
}

interface ConflictFile {
  status: string;
  path: string;
}

export interface BranchActions {
  branches: BranchData | null;
  conflictFiles: ConflictFile[];
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
  handleFetch: () => Promise<boolean>;
  handleUpdateAll: () => Promise<boolean>;
  handleAbort: () => Promise<boolean>;
  handleCreateBranch: (name: string, startPoint: string) => Promise<boolean>;
}

export function useBranchActions(
  projectId: string,
  chatId: string | undefined,
  onBranchChanged: () => void,
  onClose: () => void,
): BranchActions {
  const [branches, setBranches] = useState<BranchData | null>(null);
  const [conflictFiles, setConflictFiles] = useState<ConflictFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const withBusy = useCallback(async (fn: () => Promise<void>, action?: string): Promise<boolean> => {
    setBusy(true);
    setBusyAction(action ?? null);
    try {
      await fn();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(msg);
      return false;
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  }, []);

  const loadBranches = useCallback(async () => {
    try {
      const [branchData, statusData] = await Promise.all([
        getGitBranches(projectId, chatId),
        getGitStatus(projectId, chatId),
      ]);
      setBranches(branchData);
      const conflicts = statusData.files.filter((f) => isConflictStatus(f.status));
      setConflictFiles(conflicts);
    } catch (err) {
      console.warn('[useBranchActions] loadBranches failed', err);
      toast.error('Failed to load branches');
    }
  }, [projectId, chatId]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  const confirmDirtyTree = useCallback(async (): Promise<boolean> => {
    const status = await getGitStatus(projectId, chatId);
    if (status.files.length > 0) {
      return window.confirm('You have uncommitted changes. Continue?');
    }
    return true;
  }, [projectId, chatId]);

  const handleCheckout = useCallback(
    async (branch: string) => {
      return withBusy(async () => {
        if (!(await confirmDirtyTree())) return;
        await gitCheckout(projectId, branch, chatId);
        toast.success(`Switched to ${branch}`);
        onBranchChanged();
        onClose();
      });
    },
    [projectId, chatId, onBranchChanged, onClose, confirmDirtyTree, withBusy],
  );

  const handlePull = useCallback(
    async (branch: string) => {
      return withBusy(async () => {
        // Resolve tracking remote and branch (e.g. "origin/feat/foo" → remote="origin", remoteBranch="feat/foo")
        const info = branches?.local.find((b) => b.name === branch);
        const slashIdx = info?.tracking?.indexOf('/') ?? -1;
        const remote = slashIdx > 0 ? info!.tracking!.slice(0, slashIdx) : undefined;
        const remoteBranch = slashIdx > 0 ? info!.tracking!.slice(slashIdx + 1) : undefined;
        if (!remote || !remoteBranch) {
          toast.error(`No tracking remote for ${branch}`);
          return;
        }
        const result = await gitPull(projectId, remote, remoteBranch, branch, chatId);
        if (result.status === 'conflict') {
          toast.error('Pull resulted in conflicts');
        } else if (result.status === 'up-to-date') {
          toast.info('Already up to date');
        } else {
          toast.success(result.summary.changes > 0 ? `Pulled ${result.summary.changes} changes` : `Updated ${branch}`);
        }
        onBranchChanged();
        await loadBranches();
      });
    },
    [projectId, chatId, branches, loadBranches, onBranchChanged, withBusy],
  );

  const handlePush = useCallback(
    async (branch: string) => {
      return withBusy(async () => {
        const info = branches?.local.find((b) => b.name === branch);
        const slashIdx = info?.tracking?.indexOf('/') ?? -1;
        const remote = slashIdx > 0 ? info!.tracking!.slice(0, slashIdx) : undefined;
        const result = await gitPush(projectId, branch, remote, chatId);
        if (result.status === 'rejected') {
          toast.error(`Push rejected: ${result.message}`);
        } else {
          toast.success(`Pushed to ${result.remote}/${result.branch}`);
        }
      });
    },
    [projectId, chatId, branches, withBusy],
  );

  const handleMerge = useCallback(
    async (branch: string) => {
      return withBusy(async () => {
        if (!(await confirmDirtyTree())) return;
        const result = await gitMerge(projectId, branch, chatId);
        if (result.status === 'conflict') {
          toast.error('Merge conflicts');
        } else {
          toast.success(`Merged ${result.summary.commits} commits`);
          onBranchChanged();
        }
        await loadBranches();
      });
    },
    [projectId, chatId, loadBranches, onBranchChanged, confirmDirtyTree, withBusy],
  );

  const handleRebase = useCallback(
    async (branch: string) => {
      return withBusy(async () => {
        if (!(await confirmDirtyTree())) return;
        const result = await gitRebase(projectId, branch, chatId);
        if (result.status === 'conflict') {
          toast.error('Rebase conflicts');
        } else {
          toast.success('Rebase complete');
          onBranchChanged();
        }
        await loadBranches();
      });
    },
    [projectId, chatId, loadBranches, onBranchChanged, confirmDirtyTree, withBusy],
  );

  const handleRename = useCallback(
    async (oldName: string, newName: string) => {
      return withBusy(async () => {
        await gitRenameBranch(projectId, oldName, newName, chatId);
        toast.success(`Renamed to ${newName}`);
        onBranchChanged();
        await loadBranches();
      });
    },
    [projectId, chatId, loadBranches, onBranchChanged, withBusy],
  );

  const handleDelete = useCallback(
    async (branch: string, isRemote?: boolean) => {
      const label = isRemote ? `remote branch '${branch}'` : `branch '${branch}'`;
      if (!window.confirm(`Delete ${label}?`)) return false;
      return withBusy(async () => {
        const result = await gitDeleteBranch(projectId, branch, false, isRemote, chatId);
        if (result.status === 'not-merged') {
          if (window.confirm(`${result.message}\nForce delete?`)) {
            await gitDeleteBranch(projectId, branch, true, isRemote, chatId);
            toast.success(`Deleted ${label}`);
          }
        } else {
          toast.success(`Deleted ${label}`);
        }
        await loadBranches();
      });
    },
    [projectId, chatId, loadBranches, withBusy],
  );

  const handleFetch = useCallback(async () => {
    return withBusy(async () => {
      await gitFetch(projectId, undefined, chatId);
      toast.success('Fetched');
      await loadBranches();
    }, 'fetch');
  }, [projectId, chatId, loadBranches, withBusy]);

  const handleUpdateAll = useCallback(async () => {
    return withBusy(async () => {
      const result = await gitUpdateAll(projectId, chatId);
      const updated = result.branches.filter((b) => b.status === 'updated').length;
      if (result.pull.status === 'conflict') {
        toast.error('Conflicts during update');
      } else {
        const parts: string[] = [];
        if (result.pull.status === 'success') parts.push('current branch pulled');
        if (updated > 0) parts.push(`${updated} branches updated`);
        toast.success(parts.length > 0 ? parts.join(', ') : 'All up to date');
      }
      onBranchChanged();
      await loadBranches();
    }, 'updateAll');
  }, [projectId, chatId, loadBranches, onBranchChanged, withBusy]);

  const handleAbort = useCallback(async () => {
    return withBusy(async () => {
      const result = await gitAbort(projectId, chatId);
      if (result?.aborted === false) {
        toast.info('No active merge or rebase to abort');
      } else {
        toast.success('Aborted');
      }
      await loadBranches();
    });
  }, [projectId, chatId, loadBranches, withBusy]);

  const handleCreateBranch = useCallback(
    async (name: string, startPoint: string) => {
      return withBusy(async () => {
        await gitCreateBranch(projectId, name, startPoint, chatId);
        toast.success(`Created ${name}`);
        onBranchChanged();
        await loadBranches();
      });
    },
    [projectId, chatId, loadBranches, onBranchChanged, withBusy],
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
    handleFetch,
    handleUpdateAll,
    handleAbort,
    handleCreateBranch,
  };
}
