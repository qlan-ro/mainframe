/**
 * BranchChip — the branch manager's toolbar entry: a compact chip (branch name,
 * worktree badge, no project name) opening `BranchPopover`. Lives in the
 * MainToolbar's right control cluster; the old left identity section is gone
 * (docs/plans/2026-08-08-session-tabs-and-workspace-files.md).
 *
 * Chip styling mirrors the retired left chip: worktree = accent border + tint;
 * main-repo = transparent border (no layout shift), neutral hover. The popover
 * stays off for a worktree draft — useBranchActions without a chatId would
 * mutate the ROOT repo while the chip advertises worktree isolation.
 */
import { useState } from 'react';
import { ChevronDown, FolderGit2, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { useDisplayBranch } from '@/features/sessions/use-display-branch';
import { BranchPopover } from './BranchPopover';

const CHIP =
  'inline-flex h-6 min-w-0 max-w-[190px] items-center gap-1 rounded-md border px-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

function chipClass(open: boolean, isWorktree: boolean): string {
  if (isWorktree) {
    return cn('border-primary/25 text-foreground', open ? 'bg-primary/15' : 'bg-primary/8 hover:bg-primary/12');
  }
  return cn('border-transparent text-muted-foreground', open ? 'bg-muted' : 'hover:bg-muted');
}

/** Shared chip innards — the interactive trigger and the disabled stub render identically. */
function BranchChipContent({ branch, isWorktree }: { branch: string; isWorktree: boolean }) {
  return (
    <>
      {isWorktree ? (
        <FolderGit2 className="size-4 shrink-0 text-primary" />
      ) : (
        <GitBranch className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{branch}</span>
      {isWorktree && (
        <span
          data-testid="main-toolbar-branch-wt"
          className="inline-flex h-4 shrink-0 items-center rounded-sm bg-primary/12 px-1 text-xs font-semibold tracking-wide text-primary uppercase"
        >
          wt
        </span>
      )}
      <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
    </>
  );
}

interface BranchChipProps {
  port: number;
  projectId?: string;
  chatId?: string;
  branchName?: string;
  isWorktree?: boolean;
}

export function BranchChip({ port, projectId, chatId, branchName, isWorktree = false }: BranchChipProps) {
  const [open, setOpen] = useState(false);

  // The chip shows for EVERY session, not just worktrees — see use-display-branch
  // for why that needs a live git read. `refetch` is the popover-write path: a
  // BranchPopover write broadcasts no `chat.updated`, so nothing else invalidates it.
  const {
    branch: displayBranch,
    isDraftWorktree,
    refetch: handleBranchChanged,
  } = useDisplayBranch({ port, projectId, chatId, branchName, isWorktree });

  if (!displayBranch) return null;

  if (projectId && !isDraftWorktree) {
    return (
      <BranchPopover
        port={port}
        projectId={projectId}
        chatId={chatId}
        open={open}
        onOpenChange={setOpen}
        onBranchChanged={handleBranchChanged}
        triggerLabel={isWorktree ? 'Switch branch · worktree' : 'Switch branch · main repo'}
      >
        {/* Bare trigger — BranchPopover wraps this in Hint itself (via triggerLabel),
            around DropdownMenuTrigger. A Hint here would interpose a non-forwarding
            component inside the asChild clone, dropping the ref Radix needs to
            anchor the menu (see BranchPopover.tsx's file header). */}
        <button
          data-testid="main-toolbar-branch"
          data-worktree={isWorktree ? 'true' : 'false'}
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(CHIP, 'cursor-pointer', chipClass(open, isWorktree))}
        >
          <BranchChipContent branch={displayBranch} isWorktree={isWorktree} />
        </button>
      </BranchPopover>
    );
  }

  return (
    <Hint
      label={isDraftWorktree ? 'Branch actions unlock on first message' : 'Switch branch — coming with its surface'}
    >
      <button
        data-testid="main-toolbar-branch"
        data-worktree={isWorktree ? 'true' : 'false'}
        type="button"
        disabled
        className={cn(
          CHIP,
          'cursor-not-allowed opacity-80',
          isWorktree ? 'border-primary/25 bg-primary/8 text-foreground' : 'text-muted-foreground',
        )}
      >
        <BranchChipContent branch={displayBranch} isWorktree={isWorktree} />
      </button>
    </Hint>
  );
}
