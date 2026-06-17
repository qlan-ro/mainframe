/**
 * BranchRow — single row in the branch list.
 * Shows checkmark gutter (current marker), status dot, branch name (mono),
 * ahead/behind divergence, and a chevron to open the submenu.
 */
import { Check, ChevronRight } from 'lucide-react';
import type { BranchInfo } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';

export interface BranchRowProps {
  branch: BranchInfo;
  isCurrent: boolean;
  isRemote?: boolean;
  grouped?: boolean;
  onSelect: (branch: BranchInfo) => void;
}

function BranchDivergence({ ahead, behind }: { ahead?: number; behind?: number }) {
  if (!ahead && !behind) {
    return <span className="text-caption text-mf-text-4 shrink-0">up to date</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-caption text-muted-foreground shrink-0">
      {(ahead ?? 0) > 0 && <span className="inline-flex items-center gap-0.5 text-mf-success">↑{ahead}</span>}
      {(behind ?? 0) > 0 && <span className="inline-flex items-center gap-0.5 text-mf-warning">↓{behind}</span>}
    </span>
  );
}

export function BranchRow({ branch, isCurrent, isRemote = false, grouped = false, onSelect }: BranchRowProps) {
  const { name, ahead, behind } = branch;
  const displayName = grouped && name.includes('/') ? name.slice(name.indexOf('/') + 1) : name;

  return (
    <button
      data-testid={`git-branch-row-${name}`}
      onClick={() => onSelect(branch)}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-1.5 text-left text-body',
        'hover:bg-accent rounded-sm transition-colors',
        isCurrent && 'bg-accent/50',
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
          'truncate flex-1 font-mono text-label',
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
