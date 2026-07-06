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
    return <span className="text-caption text-mf-text-4 shrink-0">up to date</span>;
  }
  return (
    <span className="inline-flex items-center gap-[7px] font-mono text-caption text-mf-text-3 shrink-0">
      {(ahead ?? 0) > 0 && (
        <span className="inline-flex items-center gap-[1px] text-mf-success">
          <ArrowUp size={9} className="text-mf-success" />
          {ahead}
        </span>
      )}
      {(behind ?? 0) > 0 && (
        <span className="inline-flex items-center gap-[1px] text-mf-warning">
          <ArrowDown size={9} className="text-mf-warning" />
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
        'w-full flex items-center gap-2 px-2 py-1.5 text-left text-body rounded-sm transition-colors',
        // Background is driven ONLY by `selected` (submenu-open state) → the neutral
        // hover tint; a merely-current (checked-out) branch is transparent when not
        // selected — only the checkmark + green dot distinguish it (findings 10.3/10.4).
        selected ? 'bg-accent' : 'hover:bg-accent',
      )}
    >
      {/* Checkmark gutter — fixed ~13px wide */}
      <span className="w-[13px] inline-flex items-center justify-center flex-shrink-0">
        {isCurrent && <Check size={11} className="text-primary" />}
      </span>
      {/* Status dot — 6px */}
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', isCurrent ? 'bg-mf-success' : 'bg-mf-text-4')} />
      {/* Branch name in monospace */}
      <span
        className={cn(
          'min-w-0 truncate flex-1 font-mono text-label',
          isCurrent && 'font-semibold text-foreground',
          !isCurrent && 'font-medium text-foreground',
        )}
      >
        {displayName}
      </span>
      {!isRemote && <BranchDivergence ahead={ahead} behind={behind} />}
      <ChevronRight size={11} className="shrink-0 text-mf-text-4" />
    </button>
  );
}
