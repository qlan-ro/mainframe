/**
 * BranchList — composes Local BranchGroupSection + WorktreeSections + Remote BranchGroupSection.
 * Filtered by the `search` prop.
 */
import { useMemo } from 'react';
import type { BranchInfo } from '@qlan-ro/mainframe-types';
import { DropdownMenuSeparator } from '@v2/components/ui/dropdown-menu';
import { filterBranches, filterRemote } from './branch-grouping';
import { BranchGroupSection } from './BranchGroupSection';
import type { BranchRowActions } from './BranchSubmenu';
import { WorktreeSection } from './WorktreeSection';

export interface BranchListProps {
  local: BranchInfo[];
  remote: string[];
  worktrees: string[];
  currentBranch: string;
  search: string;
  actions: BranchRowActions;
}

export function BranchList({ local, remote, worktrees, currentBranch, search, actions }: BranchListProps) {
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

  const searching = search.trim().length > 0;

  return (
    <div data-testid="git-branch-list">
      <BranchGroupSection
        title="Local branches"
        branches={mainBranches}
        currentBranch={currentBranch}
        forceOpen={searching}
        actions={actions}
      />

      {isEmpty && <div className="px-3 py-2 text-sm text-muted-foreground">No matching branches</div>}

      {worktreeGroups.map((wt) => (
        <WorktreeSection
          key={wt.name}
          name={wt.name}
          branches={wt.branches}
          currentBranch={currentBranch}
          actions={actions}
        />
      ))}

      {filteredRemote.length > 0 && (
        <>
          <DropdownMenuSeparator />
          {/* Remote starts collapsed — remote lists get long; search forces it open. */}
          <BranchGroupSection
            title="Remote"
            branches={remoteInfos}
            currentBranch={currentBranch}
            isRemote
            defaultOpen={false}
            forceOpen={searching}
            actions={actions}
          />
        </>
      )}
    </div>
  );
}
