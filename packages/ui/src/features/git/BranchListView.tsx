/**
 * BranchListView — the main list view of the branch popover:
 * search field + Fetch + global quick actions (New branch, Update all, Push) + BranchList.
 */
import { ArrowUp, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { MenuDivider, MenuRow } from '@/components/ui/menu';
import type { BranchInfo } from '@qlan-ro/mainframe-types';
import { BranchList } from './BranchList';

export interface BranchListViewActions {
  handleFetch: () => Promise<boolean>;
  handleUpdateAll: () => Promise<boolean>;
  handlePush: (branch: string) => Promise<boolean>;
  handleDeleteWorktree: (name: string, branchName: string | undefined) => Promise<boolean>;
  handleNewSession?: (name: string, branchName: string | undefined) => void;
}

export interface BranchListViewProps {
  local: BranchInfo[];
  remote: string[];
  worktrees: string[];
  currentBranch: string;
  selectedBranch?: string;
  search: string;
  onSearch: (v: string) => void;
  onSelectBranch: (branch: BranchInfo) => void;
  onNewBranch: () => void;
  actions: BranchListViewActions;
  busy: boolean;
  busyAction: string | null;
  searchRef?: React.RefObject<HTMLInputElement | null>;
}

export function BranchListView({
  local,
  remote,
  worktrees,
  currentBranch,
  selectedBranch,
  search,
  onSearch,
  onSelectBranch,
  onNewBranch,
  actions,
  busy,
  busyAction,
  searchRef,
}: BranchListViewProps) {
  return (
    <>
      {/* Search + Fetch */}
      <div className="flex items-center gap-1.5 px-2 pt-2 pb-1.5">
        <div className="flex-1 flex items-center gap-[7px] h-[30px] px-[9px] rounded-md border-[0.5px] border-border bg-mf-content2 transition-shadow focus-within:border-ring focus-within:shadow-[var(--mf-focus-ring)]">
          <Search size={13} className="text-muted-foreground shrink-0" />
          <input
            data-testid="git-branch-search"
            data-noring=""
            ref={searchRef}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search branches..."
            className="flex-1 bg-transparent text-body text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              data-testid="git-fetch"
              onClick={() => void actions.handleFetch()}
              disabled={busy}
              aria-label="Fetch"
              className={cn(
                'flex-shrink-0 w-[30px] h-[30px] rounded-md border-[0.5px] border-border bg-background',
                'inline-flex items-center justify-center text-muted-foreground',
                'hover:bg-accent transition-colors',
                busy && 'opacity-40 cursor-not-allowed',
              )}
            >
              <RefreshCw size={13} className={busyAction === 'fetch' ? 'animate-spin' : ''} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Fetch from all remotes</TooltipContent>
        </Tooltip>
      </div>

      {/* Quick actions */}
      <div>
        <MenuRow
          data-testid="git-new-branch"
          icon={<Plus className="text-primary" />}
          label={search ? `Create branch "${search}"` : 'New branch…'}
          onClick={onNewBranch}
        />
        <MenuRow
          data-testid="git-update-all"
          icon={busyAction === 'updateAll' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          label="Update all"
          hint="⤓"
          disabled={busy}
          onClick={() => void actions.handleUpdateAll()}
        />
        <MenuRow
          data-testid="git-push-current"
          icon={<ArrowUp />}
          label="Push"
          disabled={busy}
          onClick={() => void actions.handlePush(currentBranch)}
        />
      </div>
      <MenuDivider section />

      {/* Branch list */}
      <BranchList
        local={local}
        remote={remote}
        worktrees={worktrees}
        currentBranch={currentBranch}
        selectedBranch={selectedBranch}
        search={search}
        onSelectBranch={onSelectBranch}
        onDeleteWorktree={actions.handleDeleteWorktree}
        onNewSession={actions.handleNewSession}
        busyAction={busyAction}
      />
    </>
  );
}
