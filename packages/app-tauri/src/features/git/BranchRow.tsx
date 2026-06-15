/**
 * BranchRow — single row in the branch list.
 * Shows branch name, ahead/behind divergence chips, current marker.
 */
import { ChevronRight, GitBranch, Star } from 'lucide-react';
import type { BranchInfo } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';

const MAIN_BRANCHES = new Set(['main', 'master', 'develop']);

export interface BranchRowProps {
  branch: BranchInfo;
  isCurrent: boolean;
  isRemote?: boolean;
  grouped?: boolean;
  onSelect: (branch: BranchInfo) => void;
}

export function BranchRow({ branch, isCurrent, isRemote = false, grouped = false, onSelect }: BranchRowProps) {
  const { name, ahead, behind, tracking } = branch;
  const displayName = grouped && name.includes('/') ? name.slice(name.indexOf('/') + 1) : name;
  const isMain = !isRemote && MAIN_BRANCHES.has(name);

  return (
    <button
      data-testid={`git-branch-row-${name}`}
      onClick={() => onSelect(branch)}
      className={cn(
        'w-full flex items-center gap-1.5 px-3 py-1 text-left text-body',
        'hover:bg-accent rounded transition-colors',
        isCurrent && 'bg-accent text-primary font-medium',
      )}
    >
      {isMain ? (
        <Star size={12} className="text-mf-warning shrink-0" />
      ) : (
        <GitBranch size={12} className="shrink-0 text-muted-foreground" />
      )}
      <span className="truncate flex-1">{displayName}</span>
      {((ahead != null && ahead > 0) || (behind != null && behind > 0)) && (
        <span className="flex items-center gap-0.5 shrink-0 ml-1 text-caption text-muted-foreground">
          <span className="opacity-40">·</span>
          {behind != null && behind > 0 && <span>↓{behind}</span>}
          {ahead != null && ahead > 0 && <span>↑{ahead}</span>}
        </span>
      )}
      {tracking && (
        <span className="ml-auto shrink-0 text-caption text-muted-foreground truncate max-w-[100px]">{tracking}</span>
      )}
      <ChevronRight size={12} className={cn('shrink-0 text-muted-foreground', !tracking && 'ml-auto')} />
    </button>
  );
}
