/**
 * PROTOTYPE — remove with features/workspace-proto.
 *
 * Variant D: the branch manager as a compact chip in the toolbar's RIGHT
 * control cluster (no project name). Real BranchPopover — switching branches
 * works. The draft-worktree disabled state renders a plain chip; the full
 * disabled/tooltip treatment stays in MainToolbar's original.
 */
import { useState } from 'react';
import { ChevronDown, FolderGit2, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BranchPopover } from '@/features/git/BranchPopover';
import { useDisplayBranch } from '@/features/sessions/use-display-branch';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';

const CHIP =
  'inline-flex h-6 min-w-0 max-w-[190px] items-center gap-1 rounded-md border px-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

export function ProtoBranchChip() {
  const port = useDaemonPort();
  const { projectId, chatId, branchName, isWorktree } = useActiveIdentity();
  const [open, setOpen] = useState(false);
  const { branch, isDraftWorktree, refetch } = useDisplayBranch({ port, projectId, chatId, branchName, isWorktree });

  if (!branch) return null;

  const chipBody = (
    <>
      {isWorktree ? (
        <FolderGit2 className="size-4 shrink-0 text-primary" />
      ) : (
        <GitBranch className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{branch}</span>
      {isWorktree && (
        <span className="inline-flex h-4 shrink-0 items-center rounded-sm bg-primary/12 px-1 text-xs font-semibold tracking-wide text-primary uppercase">
          wt
        </span>
      )}
      <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
    </>
  );

  const chipClass = isWorktree
    ? cn('border-primary/25 text-foreground', open ? 'bg-primary/15' : 'bg-primary/8 hover:bg-primary/12')
    : cn('border-transparent text-muted-foreground', open ? 'bg-muted' : 'hover:bg-muted');

  if (!projectId || isDraftWorktree) {
    return (
      <span data-testid="proto-branch-chip" className={cn(CHIP, 'opacity-80', chipClass)}>
        {chipBody}
      </span>
    );
  }

  return (
    <BranchPopover
      port={port}
      projectId={projectId}
      chatId={chatId}
      open={open}
      onOpenChange={setOpen}
      onBranchChanged={refetch}
      triggerLabel={isWorktree ? 'Switch branch · worktree' : 'Switch branch · main repo'}
    >
      <button
        data-testid="proto-branch-chip"
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(CHIP, 'cursor-pointer', chipClass)}
      >
        {chipBody}
      </button>
    </BranchPopover>
  );
}
