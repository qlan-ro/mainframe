/**
 * BranchListView — the main list view of the branch popover:
 * search field + Fetch + global quick actions (New branch, Update all, Push) + BranchList.
 */
import { ArrowUp, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@v2/components/ui/input-group';
import { MenuRow } from '@v2/components/ui/menu-row';
import { Separator } from '@v2/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@v2/components/ui/tooltip';
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
      <div className="flex items-center gap-1.5 p-1 pb-1.5">
        <InputGroup className="h-8 flex-1">
          <InputGroupAddon>
            <Search className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            data-testid="git-branch-search"
            data-noring
            ref={searchRef}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search branches..."
            className="h-full text-sm"
          />
        </InputGroup>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              data-testid="git-fetch"
              variant="outline"
              size="icon-sm"
              onClick={() => void actions.handleFetch()}
              disabled={busy}
              aria-label="Fetch"
              className="text-muted-foreground"
            >
              <RefreshCw className={busyAction === 'fetch' ? 'size-3.5 animate-spin' : 'size-3.5'} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Fetch from all remotes</TooltipContent>
        </Tooltip>
      </div>

      {/* Quick actions */}
      <div>
        <MenuRow data-testid="git-new-branch" onClick={onNewBranch}>
          <Plus className="size-3.5 text-primary" />
          <span className="min-w-0 flex-1 truncate">{search ? `Create branch "${search}"` : 'New branch…'}</span>
        </MenuRow>
        <MenuRow data-testid="git-update-all" disabled={busy} onClick={() => void actions.handleUpdateAll()}>
          {busyAction === 'updateAll' ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          <span className="min-w-0 flex-1 truncate">Update all</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">⤓</span>
        </MenuRow>
        <MenuRow data-testid="git-push-current" disabled={busy} onClick={() => void actions.handlePush(currentBranch)}>
          <ArrowUp className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">Push</span>
        </MenuRow>
      </div>
      <Separator className="-mx-1 my-1 w-auto" />

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
