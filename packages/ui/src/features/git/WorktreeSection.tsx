/**
 * WorktreeSection — per-worktree branch row with New Session + Delete affordances.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight, FolderGit2, Loader2, Plus, Trash2 } from 'lucide-react';
import type { BranchInfo } from '@qlan-ro/mainframe-types';
import { Button } from '@v2/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@v2/components/ui/tooltip';
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
      <div data-testid={`git-worktree-row-${name}`} className="flex h-6.5 items-center pr-1">
        <button
          data-testid={`git-worktree-toggle-${name}`}
          onClick={() => setExpanded((v) => !v)}
          className="flex h-full flex-1 items-center gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {/* Amber, not red: a worktree marker is caution-coloured in the git family. */}
          <FolderGit2 size={12} className="shrink-0 text-mf-warning" />
          {name}
        </button>
        {onNewSession && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid={`git-worktree-new-session-${name}`}
                variant="ghost"
                size="icon-xs"
                onClick={() => onNewSession(name, branchName)}
                disabled={isDeleting}
                aria-label={`New session on worktree ${name}`}
                className="size-5 text-muted-foreground hover:text-foreground"
              >
                <Plus className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">New session on this worktree</TooltipContent>
          </Tooltip>
        )}
        {onDeleteWorktree && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid={`git-worktree-delete-${name}`}
                variant="ghost"
                size="icon-xs"
                onClick={() => onDeleteWorktree(name, branchName)}
                disabled={isDeleting}
                aria-label={`Delete worktree ${name}`}
                className="size-5 text-muted-foreground hover:text-destructive"
              >
                {isDeleting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
              </Button>
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
