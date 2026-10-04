/**
 * SummarySection — the Session section's rows: what this session IS (branch,
 * context fill) and its working changes. Detected PRs have their own section
 * (`PullRequestsSection`); the "Session" eyebrow is drawn by the panel.
 *
 * The row kinds come out of `deriveSummaryRows`, which owns every visibility
 * rule (no branch, unresolved usage), and one renderer draws them. A row that
 * has nothing to say is not emitted; when nothing is emitted at all the
 * section says so rather than rendering an empty block.
 */
import { useState } from 'react';
import { Gauge, GitBranch, GitCompare, GitPullRequest } from 'lucide-react';
import type { ComponentType } from 'react';
import { Badge } from '@/components/ui/badge';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import { useChatExtras } from '@/features/chat/runtime/chat-extras';
import { BranchPopover } from '@/features/git/BranchPopover';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDisplayBranch } from '@/features/sessions/use-display-branch';
import { toChangesSummary, useWorkingChanges } from '@/features/review/use-working-changes';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { deriveSummaryRows, type SummaryRow } from './summary-view';
import { useContextPercent } from './use-context-percent';

const ROW = 'flex items-center gap-2 rounded-md px-2 py-1';
const ROW_LABEL = 'min-w-0 flex-1 truncate text-sm';
const ROW_TRAILING = 'shrink-0 font-mono text-xs tabular-nums text-muted-foreground';

const ROW_ICON: Record<SummaryRow['kind'], ComponentType<{ className?: string }>> = {
  branch: GitBranch,
  context: Gauge,
  pr: GitPullRequest,
  changes: GitCompare,
};

function rowTestId(row: SummaryRow): string {
  return row.kind === 'pr' ? `session-panel-summary-pr-${row.number}` : `session-panel-summary-${row.kind}`;
}

/** The branch row leads with the name itself; every other kind leads with its label. */
function rowText(row: SummaryRow): string {
  return row.kind === 'branch' ? row.value : row.label;
}

function RowTrailing({ row }: { row: SummaryRow }) {
  if (row.kind === 'branch') {
    return row.isWorktree ? (
      <Badge data-testid="session-panel-summary-branch-wt" variant="outline">
        wt
      </Badge>
    ) : null;
  }
  if (row.kind === 'changes') {
    return (
      <>
        {row.value && <span className={ROW_TRAILING}>{row.value}</span>}
        {/* A clean tree has no diff to count — "+0 −0" would be noise. */}
        {row.fileCount > 0 && row.additions != null && (
          <span className="shrink-0 font-mono text-xs tabular-nums text-success">+{row.additions}</span>
        )}
        {row.fileCount > 0 && row.deletions != null && (
          <span className="shrink-0 font-mono text-xs tabular-nums text-destructive">−{row.deletions}</span>
        )}
      </>
    );
  }
  return <span className={ROW_TRAILING}>{row.value}</span>;
}

function RowBody({ row }: { row: SummaryRow }) {
  const Icon = ROW_ICON[row.kind];
  return (
    <>
      <Icon className={cn('size-3.5 shrink-0', row.kind === 'pr' ? 'text-success' : 'text-muted-foreground')} />
      <span className={ROW_LABEL}>{rowText(row)}</span>
      <RowTrailing row={row} />
    </>
  );
}

/**
 * The branch row IS the branch manager now (the titlebar chip is gone): it
 * opens the full BranchPopover. Static for a worktree draft — branch actions
 * without a chatId would mutate the ROOT repo while the row advertises
 * worktree isolation — and for a session with no project.
 */
function BranchRowView({
  row,
  port,
  projectId,
  chatId,
  disabled,
  onBranchChanged,
}: {
  row: SummaryRow;
  port: number;
  projectId?: string;
  chatId?: string;
  disabled: boolean;
  onBranchChanged: () => void;
}) {
  const [open, setOpen] = useState(false);

  if (disabled || projectId == null) return <SummaryRowView row={row} />;

  return (
    <BranchPopover
      port={port}
      projectId={projectId}
      chatId={chatId}
      open={open}
      onOpenChange={setOpen}
      onBranchChanged={onBranchChanged}
      triggerLabel="Manage branch"
    >
      {/* No onClick of its own: DropdownMenuTrigger toggles on pointerdown,
          and a second toggle here closes the menu on release. */}
      <button
        type="button"
        data-testid={rowTestId(row)}
        className={cn(ROW, 'w-full text-left transition-colors hover:bg-foreground/8')}
      >
        <RowBody row={row} />
      </button>
    </BranchPopover>
  );
}

function SummaryRowView({ row, onActivate }: { row: SummaryRow; onActivate?: () => void }) {
  const body = <RowBody row={row} />;

  return (
    <Hint label={row.tooltip}>
      {onActivate ? (
        <button
          type="button"
          data-testid={rowTestId(row)}
          onClick={onActivate}
          className={cn(ROW, 'w-full text-left transition-colors hover:bg-foreground/8')}
        >
          {body}
        </button>
      ) : (
        <div data-testid={rowTestId(row)} className={ROW}>
          {body}
        </div>
      )}
    </Hint>
  );
}

export function SummarySection({ port }: { port: number }) {
  const { projectId, chatId, branchName, isWorktree, noProject } = useActiveIdentity();
  // `refetch` is the popover-write path: a BranchPopover write broadcasts no
  // `chat.updated`, so nothing else invalidates the displayed branch.
  const { branch, isDraftWorktree, refetch } = useDisplayBranch({
    port,
    projectId,
    chatId,
    branchName,
    isWorktree,
    noProject,
  });
  const percent = useContextPercent();
  const usage = useChatExtras()?.state.contextUsage;
  const changes = useWorkingChanges({ port, projectId, chatId, noProject });

  const rows = deriveSummaryRows({
    branch: { name: branch ?? null, isWorktree },
    context: { percent, usedTokens: usage?.totalTokens, maxTokens: usage?.maxTokens },
    // PRs render in their own section now.
    prs: [],
    // Loading and error both mean "unknown", and a zero count would claim the
    // tree is clean. The row waits rather than lying.
    changes: projectId && !changes.loading && !changes.error ? toChangesSummary(changes) : null,
  });

  // No heading of its own: the panel's "Session" eyebrow names it.
  return (
    <div data-testid="session-panel-section-summary" className="shrink-0">
      <div className="flex flex-col gap-0.5 px-2 pb-2">
        {rows.length === 0 ? (
          <div data-testid="session-panel-summary-empty" className={cn(ROW, 'text-sm text-muted-foreground')}>
            No session details yet
          </div>
        ) : (
          rows.map((row) =>
            row.kind === 'branch' ? (
              <BranchRowView
                key={rowTestId(row)}
                row={row}
                port={port}
                projectId={projectId}
                chatId={chatId}
                disabled={isDraftWorktree}
                onBranchChanged={refetch}
              />
            ) : (
              <SummaryRowView
                key={rowTestId(row)}
                row={row}
                onActivate={row.kind === 'changes' ? () => emitSurfaceIntent({ type: 'open-review' }) : undefined}
              />
            ),
          )
        )}
      </div>
    </div>
  );
}
