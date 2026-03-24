import { useCallback, useEffect, useState } from 'react';
import type { BranchInfo } from '@qlan-ro/mainframe-types';
import { toast } from '../../lib/toast';
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
}

interface ConflictFile {
  status: string;
  path: string;
}

export interface BranchActions {
  branches: BranchData | null;
  conflictFiles: ConflictFile[];
  busy: boolean;
  loadBranches: () => Promise<void>;
  handleCheckout: (branch: string) => Promise<void>;
  handlePull: (branch: string) => Promise<void>;
  handlePush: (branch: string) => Promise<void>;
  handleMerge: (branch: string) => Promise<void>;
  handleRebase: (branch: string) => Promise<void>;
  handleRename: (oldName: string, newName: string) => Promise<void>;
  handleDelete: (branch: string) => Promise<void>;
  handleFetch: () => Promise<void>;
  handleUpdateAll: () => Promise<void>;
  handleAbort: () => Promise<void>;
  handleCreateBranch: (name: string, startPoint: string) => Promise<void>;
}

export function useBranchActions(projectId: string, onBranchChanged: () => void, onClose: () => void): BranchActions {
  const [branches, setBranches] = useState<BranchData | null>(null);
  const [conflictFiles, setConflictFiles] = useState<ConflictFile[]>([]);
  const [busy, setBusy] = useState(false);

  const withBusy = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }, []);

  const loadBranches = useCallback(async () => {
    try {
      const [branchData, statusData] = await Promise.all([getGitBranches(projectId), getGitStatus(projectId)]);
      setBranches(branchData);
      const conflicts = statusData.files.filter((f) => f.status === 'U' || f.status === 'UU');
      setConflictFiles(conflicts);
    } catch {
      toast.error('Failed to load branches');
    }
  }, [projectId]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  const confirmDirtyTree = useCallback(async (): Promise<boolean> => {
    const status = await getGitStatus(projectId);
    if (status.files.length > 0) {
      return window.confirm('You have uncommitted changes. Continue?');
    }
    return true;
  }, [projectId]);

  const handleCheckout = useCallback(
    async (branch: string) => {
      await withBusy(async () => {
        if (!(await confirmDirtyTree())) return;
        await gitCheckout(projectId, branch);
        toast.success(`Switched to ${branch}`);
        onBranchChanged();
        onClose();
      });
    },
    [projectId, onBranchChanged, onClose, confirmDirtyTree, withBusy],
  );

  const handlePull = useCallback(
    async (branch: string) => {
      await withBusy(async () => {
        const result = await gitPull(projectId, undefined, branch);
        if (result.status === 'conflict') {
          toast.error('Pull resulted in conflicts');
        } else if (result.status === 'up-to-date') {
          toast.info('Already up to date');
        } else {
          toast.success(`Pulled ${result.summary.changes} changes`);
        }
        onBranchChanged();
        await loadBranches();
      });
    },
    [projectId, loadBranches, onBranchChanged, withBusy],
  );

  const handlePush = useCallback(
    async (branch: string) => {
      await withBusy(async () => {
        const result = await gitPush(projectId, branch);
        if (result.status === 'rejected') {
          toast.error(`Push rejected: ${result.message}`);
        } else {
          toast.success(`Pushed to ${result.remote}/${result.branch}`);
        }
      });
    },
    [projectId, withBusy],
  );

  const handleMerge = useCallback(
    async (branch: string) => {
      await withBusy(async () => {
        if (!(await confirmDirtyTree())) return;
        const result = await gitMerge(projectId, branch);
        if (result.status === 'conflict') {
          toast.error('Merge conflicts');
        } else {
          toast.success(`Merged ${result.summary.commits} commits`);
          onBranchChanged();
        }
        await loadBranches();
      });
    },
    [projectId, loadBranches, onBranchChanged, confirmDirtyTree, withBusy],
  );

  const handleRebase = useCallback(
    async (branch: string) => {
      await withBusy(async () => {
        if (!(await confirmDirtyTree())) return;
        const result = await gitRebase(projectId, branch);
        if (result.status === 'conflict') {
          toast.error('Rebase conflicts');
        } else {
          toast.success('Rebase complete');
          onBranchChanged();
        }
        await loadBranches();
      });
    },
    [projectId, loadBranches, onBranchChanged, confirmDirtyTree, withBusy],
  );

  const handleRename = useCallback(
    async (oldName: string, newName: string) => {
      await withBusy(async () => {
        await gitRenameBranch(projectId, oldName, newName);
        toast.success(`Renamed to ${newName}`);
        onBranchChanged();
        await loadBranches();
      });
    },
    [projectId, loadBranches, onBranchChanged, withBusy],
  );

  const handleDelete = useCallback(
    async (branch: string) => {
      if (!window.confirm(`Delete branch '${branch}'?`)) return;
      await withBusy(async () => {
        const result = await gitDeleteBranch(projectId, branch);
        if (result.status === 'not-merged') {
          if (window.confirm(`${result.message}\nForce delete?`)) {
            await gitDeleteBranch(projectId, branch, true);
            toast.success(`Deleted ${branch}`);
          }
        } else {
          toast.success(`Deleted ${branch}`);
        }
        await loadBranches();
      });
    },
    [projectId, loadBranches, withBusy],
  );

  const handleFetch = useCallback(async () => {
    await withBusy(async () => {
      await gitFetch(projectId);
      toast.success('Fetched');
      await loadBranches();
    });
  }, [projectId, loadBranches, withBusy]);

  const handleUpdateAll = useCallback(async () => {
    await withBusy(async () => {
      const result = await gitUpdateAll(projectId);
      if (result.pull.status === 'conflict') {
        toast.error('Conflicts during update');
      } else {
        toast.success('Updated');
      }
      onBranchChanged();
      await loadBranches();
    });
  }, [projectId, loadBranches, onBranchChanged, withBusy]);

  const handleAbort = useCallback(async () => {
    await withBusy(async () => {
      await gitAbort(projectId);
      toast.success('Aborted');
      await loadBranches();
    });
  }, [projectId, loadBranches, withBusy]);

  const handleCreateBranch = useCallback(
    async (name: string, startPoint: string) => {
      await gitCreateBranch(projectId, name, startPoint);
      toast.success(`Created ${name}`);
      onBranchChanged();
      await loadBranches();
    },
    [projectId, loadBranches, onBranchChanged],
  );

  return {
    branches,
    conflictFiles,
    busy,
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
