/**
 * BranchRow — single row in the branch list.
 * Shows checkmark gutter (current marker), status dot, branch name (mono),
 * ahead/behind divergence, and a chevron to open the submenu.
 */
import { ArrowDown, ArrowUp, Check, ChevronRight } from 'lucide-react';
import type { BranchInfo } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';

export interface BranchRowProps {
  branch: BranchInfo;
  isCurrent: boolean;
  isRemote?: boolean;
  grouped?: boolean;
  /** True when this row is the branch whose submenu is open beside the list. */
  selected?: boolean;
  onSelect: (branch: BranchInfo) => void;
}

function BranchDivergence({ ahead, behind }: { ahead?: number; behind?: number }) {
  if (!ahead && !behind) {
    return <span className="shrink-0 text-xs text-muted-foreground">up to date</span>;
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-2 font-mono text-xs text-foreground">
      {(ahead ?? 0) > 0 && (
        <span className="inline-flex items-center gap-px">
          <ArrowUp size={12} className="text-success" />
          {ahead}
        </span>
      )}
      {(behind ?? 0) > 0 && (
        <span className="inline-flex items-center gap-px">
          {/* Amber, not red: divergence is caution, not the v2 wrong-but-not-broken warning. */}
          <ArrowDown size={12} className="text-mf-warning" />
          {behind}
        </span>
      )}
    </span>
  );
}

export function BranchRow({
  branch,
  isCurrent,
  isRemote = false,
  grouped = false,
  selected = false,
  onSelect,
}: BranchRowProps) {
  const { name, ahead, behind } = branch;
  const displayName = grouped && name.includes('/') ? name.slice(name.indexOf('/') + 1) : name;

  return (
    <button
      data-testid={`git-branch-row-${name}`}
      aria-selected={selected}
      onClick={() => onSelect(branch)}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors outline-hidden',
        // Background is driven ONLY by `selected` (submenu-open state) → the neutral
        // hover tint; a merely-current (checked-out) branch is transparent when not
        // selected — only the checkmark + green dot distinguish it (findings 10.3/10.4).
        selected ? 'bg-accent' : 'hover:bg-accent',
      )}
    >
      {/* Checkmark gutter — fixed ~13px wide */}
      <span className="inline-flex w-3.5 shrink-0 items-center justify-center">
        {isCurrent && <Check size={11} className="text-primary" />}
      </span>
      {/* Status dot — 6px */}
      <span className={cn('size-1.5 shrink-0 rounded-full', isCurrent ? 'bg-success' : 'bg-muted-foreground/40')} />
      {/* Branch name in monospace — text-sm like every interactive row here;
          11px mono made the primary content read smaller than the action rows. */}
      <span
        className={cn(
          'min-w-0 flex-1 truncate font-mono text-sm text-foreground',
          isCurrent ? 'font-semibold' : 'font-medium',
        )}
      >
        {displayName}
      </span>
      {!isRemote && <BranchDivergence ahead={ahead} behind={behind} />}
      <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
    </button>
  );
}
