/**
 * WorktreeSection — a worktree's branches under a labeled group. The
 * new-session / delete-worktree affordances live in each branch's flyout
 * (BranchSubmenu) — the label row carries no buttons of its own.
 */
import { FolderGit2 } from 'lucide-react';
import type { BranchInfo } from '@qlan-ro/mainframe-types';
import { DropdownMenuGroup, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { BranchRow } from './BranchRow';
import type { BranchRowActions } from './BranchSubmenu';

export interface WorktreeSectionProps {
  name: string;
  branches: BranchInfo[];
  currentBranch: string;
  actions: BranchRowActions;
}

export function WorktreeSection({ name, branches, currentBranch, actions }: WorktreeSectionProps) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel data-testid={`git-worktree-row-${name}`} className="flex items-center gap-1">
        {/* Amber, not red: a worktree marker is caution-coloured in the git family. */}
        <FolderGit2 className="size-3 shrink-0 text-warning" />
        <span className="truncate">{name}</span>
      </DropdownMenuLabel>
      {branches.map((b) => (
        <BranchRow key={b.name} branch={b} isCurrent={b.name === currentBranch} actions={actions} />
      ))}
    </DropdownMenuGroup>
  );
}
