/**
 * BranchList — composes Local BranchGroupSection + WorktreeSections + Remote BranchGroupSection.
 * Filtered by the `search` prop.
 */
import { useMemo } from 'react';
import type { BranchInfo } from '@qlan-ro/mainframe-types';
import { filterBranches, filterRemote } from './branch-grouping';
import { BranchGroupSection } from './BranchGroupSection';
import { WorktreeSection } from './WorktreeSection';

export interface BranchListProps {
  local: BranchInfo[];
  remote: string[];
  worktrees: string[];
  currentBranch: string;
  search: string;
  onSelectBranch: (branch: BranchInfo) => void;
  onDeleteWorktree?: (worktreeDirName: string, branchName: string | undefined) => void;
  onNewSession?: (worktreeDirName: string, branchName: string | undefined) => void;
  busyAction?: string | null;
}

export function BranchList({
  local,
  remote,
  worktrees,
  currentBranch,
  search,
  onSelectBranch,
  onDeleteWorktree,
  onNewSession,
  busyAction,
}: BranchListProps) {
  const mainBranches = useMemo(
    () =>
      filterBranches(
        local.filter((b) => !b.worktree),
        search,
      ),
    [local, search],
  );

  const filteredRemote = useMemo(() => filterRemote(remote, search), [remote, search]);

  const worktreeGroups = useMemo(() => {
    const filtered = filterBranches(
      local.filter((b) => !!b.worktree),
      search,
    );
    const map = new Map<string, BranchInfo[]>();
    for (const b of filtered) {
      const wt = b.worktree!;
      const list = map.get(wt) ?? [];
      list.push(b);
      map.set(wt, list);
    }
    return worktrees.filter((w) => map.has(w)).map((w) => ({ name: w, branches: map.get(w)! }));
  }, [local, worktrees, search]);

  const isEmpty = mainBranches.length === 0 && worktreeGroups.length === 0 && filteredRemote.length === 0;

  const remoteInfos: BranchInfo[] = useMemo(
    () => filteredRemote.map((name) => ({ name, current: false, ahead: 0, behind: 0 })),
    [filteredRemote],
  );

  return (
    <div data-testid="git-branch-list" className="max-h-60 overflow-y-auto">
      <BranchGroupSection
        title="Local"
        branches={mainBranches}
        currentBranch={currentBranch}
        onSelect={onSelectBranch}
      />

      {isEmpty && <div className="px-3 py-2 text-body text-muted-foreground">No matching branches</div>}

      {worktreeGroups.map((wt) => (
        <WorktreeSection
          key={wt.name}
          name={wt.name}
          branches={wt.branches}
          currentBranch={currentBranch}
          onSelect={onSelectBranch}
          onDeleteWorktree={onDeleteWorktree}
          onNewSession={onNewSession}
          busyAction={busyAction}
        />
      ))}

      {filteredRemote.length > 0 && (
        <>
          <div className="border-t border-border my-1" />
          <BranchGroupSection
            title="Remote"
            branches={remoteInfos}
            currentBranch={currentBranch}
            isRemote
            onSelect={onSelectBranch}
          />
        </>
      )}
    </div>
  );
}
