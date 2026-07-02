/**
 * WorktreeSection — per-worktree branch row with New Session + Delete affordances.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight, GitFork, Loader2, Plus, Trash2 } from 'lucide-react';
import type { BranchInfo } from '@qlan-ro/mainframe-types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { BranchRow } from './BranchRow';

export interface WorktreeSectionProps {
  name: string;
  branches: BranchInfo[];
  currentBranch: string;
  selectedBranch?: string;
  onSelect: (branch: BranchInfo) => void;
  onNewSession?: (worktreeDirName: string, branchName: string | undefined) => void;
  onDeleteWorktree?: (worktreeDirName: string, branchName: string | undefined) => void;
  busyAction?: string | null;
}

export function WorktreeSection({
  name,
  branches,
  currentBranch,
  selectedBranch,
  onSelect,
  onNewSession,
  onDeleteWorktree,
  busyAction,
}: WorktreeSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const branchName = branches[0]?.name;
  const isDeleting = busyAction === `deleteWorktree:${name}`;

  return (
    <>
      <div data-testid={`git-worktree-row-${name}`} className="flex items-center h-[26px] pr-1.5">
        <button
          data-testid={`git-worktree-toggle-${name}`}
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 h-[26px] flex items-center gap-[5px] px-2 text-micro font-bold text-mf-text-3 uppercase tracking-wide"
        >
          {expanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
          <GitFork size={11} className="text-mf-warning shrink-0" />
          {name}
        </button>
        {onNewSession && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                data-testid={`git-worktree-new-session-${name}`}
                onClick={() => onNewSession(name, branchName)}
                disabled={isDeleting}
                className={cn(
                  'p-1 mr-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors',
                  isDeleting && 'opacity-40 cursor-not-allowed',
                )}
                aria-label={`New session on worktree ${name}`}
              >
                <Plus size={11} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">New session on this worktree</TooltipContent>
          </Tooltip>
        )}
        {onDeleteWorktree && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                data-testid={`git-worktree-delete-${name}`}
                onClick={() => onDeleteWorktree(name, branchName)}
                disabled={isDeleting}
                className={cn(
                  'p-1 rounded hover:bg-accent text-muted-foreground hover:text-destructive transition-colors',
                  isDeleting && 'opacity-60 cursor-not-allowed',
                )}
                aria-label={`Delete worktree ${name}`}
              >
                {isDeleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{isDeleting ? 'Deleting…' : 'Delete worktree'}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {expanded &&
        branches.map((b) => (
          <BranchRow
            key={b.name}
            branch={b}
            isCurrent={b.name === currentBranch}
            selected={b.name === selectedBranch}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}
