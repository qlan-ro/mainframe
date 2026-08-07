/**
 * PROTOTYPE — remove with features/workspace-proto.
 *
 * Variant C: the session panel's Summary branch row IS the branch manager —
 * clicking it opens the real BranchPopover in place of the toolbar chip.
 * Row chrome mirrors SummarySection's ROW recipe so it sits indistinguishably
 * among its siblings.
 */
import { useState } from 'react';
import { ChevronDown, GitBranch } from 'lucide-react';
import { Badge } from '@v2/components/ui/badge';
import { cn } from '@v2/lib/utils';
import { BranchPopover } from '@/features/git/BranchPopover';
import { useDisplayBranch } from '@/features/sessions/use-display-branch';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';

const ROW = 'flex items-center gap-2 rounded-md px-2 py-1';

export function ProtoSummaryBranchRow() {
  const port = useDaemonPort();
  const { projectId, chatId, branchName, isWorktree } = useActiveIdentity();
  const [open, setOpen] = useState(false);
  const { branch, isDraftWorktree, refetch } = useDisplayBranch({ port, projectId, chatId, branchName, isWorktree });

  if (!branch) return null;

  const body = (
    <>
      <GitBranch className={cn('size-3.5 shrink-0', isWorktree ? 'text-primary' : 'text-muted-foreground')} />
      <span className="min-w-0 flex-1 truncate text-sm">{branch}</span>
      {isWorktree && <Badge variant="outline">wt</Badge>}
      <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
    </>
  );

  if (!projectId || isDraftWorktree) {
    return (
      <div data-testid="proto-summary-branch" className={ROW}>
        {body}
      </div>
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
        data-testid="proto-summary-branch"
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(ROW, 'w-full text-left transition-colors hover:bg-foreground/8', open && 'bg-foreground/8')}
      >
        {body}
      </button>
    </BranchPopover>
  );
}
