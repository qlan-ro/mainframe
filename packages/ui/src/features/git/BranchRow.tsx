/**
 * BranchRow — one branch as a native DropdownMenuSub: the SubTrigger row shows
 * checkmark gutter (current marker), status dot, name, ahead/behind divergence
 * (the primitive appends the chevron); the flyout is BranchSubmenu.
 */
import { ArrowDown, ArrowUp, Check } from 'lucide-react';
import type { BranchInfo } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { DropdownMenuSub, DropdownMenuSubTrigger } from '@v2/components/ui/dropdown-menu';
import { BranchSubmenu, type BranchRowActions } from './BranchSubmenu';

export interface BranchRowProps {
  branch: BranchInfo;
  isCurrent: boolean;
  isRemote?: boolean;
  grouped?: boolean;
  actions: BranchRowActions;
}

function BranchDivergence({ ahead, behind }: { ahead?: number; behind?: number }) {
  if (!ahead && !behind) {
    return <span className="shrink-0 text-xs text-muted-foreground">up to date</span>;
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-2 font-mono text-xs text-foreground">
      {(ahead ?? 0) > 0 && (
        <span className="inline-flex items-center gap-px">
          <ArrowUp className="size-3 text-success" />
          {ahead}
        </span>
      )}
      {(behind ?? 0) > 0 && (
        <span className="inline-flex items-center gap-px">
          {/* Amber, not red: divergence is caution, not the v2 wrong-but-not-broken warning. */}
          <ArrowDown className="size-3 text-mf-warning" />
          {behind}
        </span>
      )}
    </span>
  );
}

export function BranchRow({ branch, isCurrent, isRemote = false, grouped = false, actions }: BranchRowProps) {
  const { name, ahead, behind } = branch;
  const displayName = grouped && name.includes('/') ? name.slice(name.indexOf('/') + 1) : name;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid={`git-branch-row-${name}`} className={cn(grouped && 'pl-4')}>
        {/* Checkmark gutter — fixed width so names align across rows */}
        <span className="inline-flex w-3.5 shrink-0 items-center justify-center">
          {isCurrent && <Check className="size-3 text-primary" />}
        </span>
        {/* Status dot — 6px */}
        <span className={cn('size-1.5 shrink-0 rounded-full', isCurrent ? 'bg-success' : 'bg-muted-foreground/40')} />
        <span
          className={cn('min-w-0 flex-1 truncate text-sm text-foreground', isCurrent ? 'font-semibold' : 'font-medium')}
        >
          {displayName}
        </span>
        {!isRemote && <BranchDivergence ahead={ahead} behind={behind} />}
      </DropdownMenuSubTrigger>
      <BranchSubmenu
        branch={name}
        isCurrent={isCurrent}
        isRemote={isRemote}
        worktree={branch.worktree}
        actions={actions}
      />
    </DropdownMenuSub>
  );
}
