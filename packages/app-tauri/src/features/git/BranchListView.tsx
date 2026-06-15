/**
 * BranchListView — the main list view of the branch popover:
 * search field + Fetch + global quick actions (New branch, Update all, Push) + BranchList.
 */
import { ArrowDownLeft, Loader2, Plus, RefreshCw, Search, Upload } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
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
      <div className="flex items-center gap-1.5 p-2 border-b border-border">
        <div className="flex-1 flex items-center gap-1 px-2 py-1 rounded border border-border bg-background">
          <Search size={12} className="text-muted-foreground shrink-0" />
          <input
            data-testid="git-branch-search"
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
                'p-1.5 rounded hover:bg-accent text-muted-foreground',
                busy && 'opacity-40 cursor-not-allowed',
              )}
            >
              <ArrowDownLeft size={12} className={busyAction === 'fetch' ? 'animate-pulse' : ''} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Fetch from all remotes</TooltipContent>
        </Tooltip>
      </div>

      {/* Quick actions */}
      <div className="border-b border-border">
        <button
          data-testid="git-new-branch"
          onClick={onNewBranch}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-body text-foreground hover:bg-accent"
        >
          <Plus size={12} />
          <span>New Branch...</span>
        </button>
        <button
          data-testid="git-update-all"
          onClick={() => void actions.handleUpdateAll()}
          disabled={busy}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-1.5 text-body text-foreground hover:bg-accent',
            busy && 'opacity-40 cursor-not-allowed',
          )}
        >
          {busyAction === 'updateAll' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          <span>Update All</span>
        </button>
        <button
          data-testid="git-push-current"
          onClick={() => void actions.handlePush(currentBranch)}
          disabled={busy}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-1.5 text-body text-foreground hover:bg-accent',
            busy && 'opacity-40 cursor-not-allowed',
          )}
        >
          <Upload size={12} />
          <span>Push</span>
        </button>
      </div>

      {/* Branch list */}
      <BranchList
        local={local}
        remote={remote}
        worktrees={worktrees}
        currentBranch={currentBranch}
        search={search}
        onSelectBranch={onSelectBranch}
        onDeleteWorktree={actions.handleDeleteWorktree}
        onNewSession={actions.handleNewSession}
        busyAction={busyAction}
      />
    </>
  );
}
