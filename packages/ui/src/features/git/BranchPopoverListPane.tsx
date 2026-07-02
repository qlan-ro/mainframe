/**
 * BranchPopoverListPane — the side-by-side list + submenu view for
 * BranchPopover ('list' view only). Extracted to keep BranchPopover.tsx
 * under the 300-line file limit; wiring stays in the parent, this component
 * is purely presentational plumbing between BranchListView and BranchSubmenu.
 */
import { cn } from '@/lib/utils';
import type { BranchInfo } from '@qlan-ro/mainframe-types';
import { BranchListView, type BranchListViewActions } from './BranchListView';
import { BranchSubmenu } from './BranchSubmenu';

interface SelectedBranch {
  info: BranchInfo;
  isRemote: boolean;
}

export interface BranchPopoverListPaneProps {
  panelCard: string;
  localBranches: BranchInfo[];
  remoteNames: string[];
  worktrees: string[];
  currentBranch: string;
  selected: SelectedBranch | null;
  search: string;
  onSearch: (v: string) => void;
  onSelectBranch: (branch: BranchInfo) => void;
  onNewBranch: () => void;
  listActions: BranchListViewActions;
  busy: boolean;
  busyAction: string | null;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onCheckout: (branch: string) => void;
  onPull: (branch: string) => void;
  onPush: (branch: string) => void;
  onMerge: (branch: string) => void;
  onRebase: (branch: string) => void;
  onRename: (branch: string) => void;
  onDelete: (branch: string, isRemote?: boolean) => void;
  onNewBranchFrom: (branch: string) => void;
  onNewSession?: (branch: string) => void;
  onDeleteWorktree?: (branch: string) => void;
}

export function BranchPopoverListPane({
  panelCard,
  localBranches,
  remoteNames,
  worktrees,
  currentBranch,
  selected,
  search,
  onSearch,
  onSelectBranch,
  onNewBranch,
  listActions,
  busy,
  busyAction,
  searchRef,
  onCheckout,
  onPull,
  onPush,
  onMerge,
  onRebase,
  onRename,
  onDelete,
  onNewBranchFrom,
  onNewSession,
  onDeleteWorktree,
}: BranchPopoverListPaneProps) {
  const isSelectedWorktree = selected != null && !!selected.info.worktree;

  return (
    <div className="flex items-start gap-1.5">
      <div className={cn(panelCard, 'w-[300px] shrink-0')}>
        <BranchListView
          local={localBranches}
          remote={remoteNames}
          worktrees={worktrees}
          currentBranch={currentBranch}
          selectedBranch={selected?.info.name}
          search={search}
          onSearch={onSearch}
          onSelectBranch={onSelectBranch}
          onNewBranch={onNewBranch}
          actions={listActions}
          busy={busy}
          busyAction={busyAction}
          searchRef={searchRef}
        />
      </div>
      {selected != null && (
        <div className={cn(panelCard, 'w-[260px] shrink-0')}>
          <BranchSubmenu
            branch={selected.info.name}
            isCurrent={selected.info.name === currentBranch}
            isRemote={selected.isRemote}
            isWorktree={isSelectedWorktree}
            onCheckout={onCheckout}
            onPull={onPull}
            onPush={onPush}
            onMerge={onMerge}
            onRebase={onRebase}
            onRename={onRename}
            onDelete={onDelete}
            onNewBranchFrom={onNewBranchFrom}
            onNewSession={isSelectedWorktree ? onNewSession : undefined}
            onDeleteWorktree={isSelectedWorktree ? onDeleteWorktree : undefined}
            busy={busy}
          />
        </div>
      )}
    </div>
  );
}
