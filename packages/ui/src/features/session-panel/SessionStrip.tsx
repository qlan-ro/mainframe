/**
 * SessionStrip — where the session runs and what it changed, as a bare row of
 * quiet controls under the composer: the branch manager on the left, the
 * working changes pushed right. It carries what the session panel's Session
 * section held (R2) and is the start of the composer's bottom strip (K6, K8).
 * Hidden before the first message.
 */
import { useState } from 'react';
import { GitBranch, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { BranchPopover } from '@/features/git/BranchPopover';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDisplayBranch } from '@/features/sessions/use-display-branch';
import { toChangesSummary, useWorkingChanges } from '@/features/review/use-working-changes';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { emitSurfaceIntent } from '@/store/surface-intents';

const CONTROL = 'min-w-0 gap-1.5 px-1.5 font-normal text-muted-foreground hover:text-foreground';

function directoryName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function Location({
  isWorktree,
  worktreePath,
  projectPath,
}: {
  isWorktree: boolean;
  worktreePath?: string;
  projectPath?: string;
}) {
  const path = isWorktree ? worktreePath : projectPath;
  return (
    <span data-testid="session-strip-worktree" className="shrink-0">
      {isWorktree ? 'Worktree' : 'Local'}
      {path && <span className="sr-only"> {directoryName(path)}</span>}
    </span>
  );
}

function BranchControl({ port }: { port: number }) {
  const { projectId, chatId, branchName, isWorktree, noProject, worktreePath, projectPath } = useActiveIdentity();
  // `refetch` is the popover-write path: a BranchPopover write broadcasts no
  // `chat.updated`, so nothing else invalidates the displayed branch.
  const { branch, refetch } = useDisplayBranch({ port, projectId, chatId, branchName, isWorktree, noProject });
  const [open, setOpen] = useState(false);
  if (projectId == null || branch == null) return null;
  const Icon = isWorktree ? GitBranch : Monitor;
  return (
    <BranchPopover
      port={port}
      projectId={projectId}
      chatId={chatId}
      open={open}
      onOpenChange={setOpen}
      onBranchChanged={refetch}
      triggerLabel={['Manage branch', isWorktree ? worktreePath : projectPath].filter(Boolean).join(' · ')}
    >
      {/* No onClick of its own: DropdownMenuTrigger toggles on pointerdown,
          and a second toggle here closes the menu on release. */}
      <Button data-testid="session-strip-branch" variant="ghost" size="xs" className={CONTROL}>
        <Icon aria-hidden />
        <Location isWorktree={isWorktree} worktreePath={worktreePath} projectPath={projectPath} />
        <span aria-hidden>·</span>
        <span className="min-w-0 truncate">{branch}</span>
      </Button>
    </BranchPopover>
  );
}

function ChangesControl({ port }: { port: number }) {
  const { projectId, chatId, noProject } = useActiveIdentity();
  const changes = useWorkingChanges({ port, projectId, chatId, noProject });
  // Loading and error both mean "unknown"; a zero count would claim a clean tree.
  if (projectId == null || changes.loading || changes.error) return null;
  const { fileCount, additions, deletions } = toChangesSummary(changes);
  if (fileCount === 0) return null;
  const files = `${fileCount} ${fileCount === 1 ? 'file' : 'files'} changed`;
  return (
    <Hint label={`${files} · open the review panel`}>
      <Button
        data-testid="session-strip-changes"
        aria-label={[files, additions != null && `${additions} added`, deletions != null && `${deletions} removed`]
          .filter(Boolean)
          .join(', ')}
        variant="ghost"
        size="xs"
        onClick={() => emitSurfaceIntent({ type: 'open-review' })}
        className={`${CONTROL} ml-auto shrink-0 tabular-nums`}
      >
        {additions == null && deletions == null && files}
        {additions != null && <span className="text-success">+{additions}</span>}
        {deletions != null && <span className="text-destructive">−{deletions}</span>}
      </Button>
    </Hint>
  );
}

export function SessionStrip() {
  const port = useDaemonPort();
  const { chatId, projectId } = useActiveIdentity();
  if (chatId == null || projectId == null) return null;
  return (
    <div data-testid="session-strip" className="flex h-7 shrink-0 items-end gap-2 px-1.5">
      <BranchControl port={port} />
      <ChangesControl port={port} />
    </div>
  );
}
