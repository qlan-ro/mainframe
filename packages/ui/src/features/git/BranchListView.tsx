/**
 * BranchListView — the branch menu's body: search field + Fetch, global quick
 * actions (New branch, Update all, Push), and the grouped BranchList. Renders
 * inside BranchPopover's DropdownMenuContent.
 */
import { ArrowUp, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut } from '@v2/components/ui/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@v2/components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@v2/components/ui/tooltip';
import type { BranchInfo } from '@qlan-ro/mainframe-types';
import type { BranchRowActions } from './BranchSubmenu';
import { BranchList } from './BranchList';

export interface BranchListViewActions {
  handleFetch: () => Promise<boolean>;
  handleUpdateAll: () => Promise<boolean>;
  handlePush: (branch: string) => Promise<boolean>;
}

export interface BranchListViewProps {
  local: BranchInfo[];
  remote: string[];
  worktrees: string[];
  currentBranch: string;
  search: string;
  onSearch: (v: string) => void;
  onNewBranch: () => void;
  actions: BranchListViewActions;
  rowActions: BranchRowActions;
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
  onNewBranch,
  actions,
  rowActions,
  busy,
  busyAction,
  searchRef,
}: BranchListViewProps) {
  return (
    <>
      {/* Search + Fetch. Keystrokes stay in the input — without stopPropagation
          the menu's typeahead would eat them as item navigation. Escape passes
          through so the menu still closes. */}
      <div
        className="flex items-center gap-1.5 p-1 pb-1.5"
        onKeyDown={(e) => {
          if (e.key !== 'Escape') e.stopPropagation();
        }}
      >
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

      {/* Quick actions. Update all / Push keep the menu open (preventDefault)
          so their busy spinners stay visible; New branch closes it and opens
          the dialog. */}
      <DropdownMenuItem data-testid="git-new-branch" onSelect={onNewBranch}>
        <Plus className="size-3.5 text-primary" />
        <span className="min-w-0 flex-1 truncate">{search ? `Create branch "${search}"` : 'New branch…'}</span>
      </DropdownMenuItem>
      <DropdownMenuItem
        data-testid="git-update-all"
        disabled={busy}
        onSelect={(e) => {
          e.preventDefault();
          void actions.handleUpdateAll();
        }}
      >
        {busyAction === 'updateAll' ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
        <span className="min-w-0 flex-1 truncate">Update all</span>
        <DropdownMenuShortcut>⤓</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem
        data-testid="git-push-current"
        disabled={busy}
        onSelect={(e) => {
          e.preventDefault();
          void actions.handlePush(currentBranch);
        }}
      >
        <ArrowUp className="size-3.5" />
        <span className="min-w-0 flex-1 truncate">Push</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />

      {/* Branch list */}
      <BranchList
        local={local}
        remote={remote}
        worktrees={worktrees}
        currentBranch={currentBranch}
        search={search}
        actions={rowActions}
      />
    </>
  );
}
