/**
 * SummarySection — the panel's top section: what this session IS (branch,
 * context fill) and what it has produced (detected PRs, working changes).
 *
 * Never collapsible, so its heading is a static row rather than a trigger —
 * same rhythm and ink as the section headers below it, minus the chevron. It
 * carries the panel's own collapse instead, on the trailing edge: the top row is
 * the only fixed place to put it once the title bar went away.
 *
 * The four row kinds come out of `deriveSummaryRows`, which owns every
 * visibility rule (no branch, no PRs, unresolved usage), and one renderer draws
 * them. A row that has nothing to say is not emitted; when nothing is emitted at
 * all the section says so rather than rendering an empty card.
 */
import { useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { Gauge, GitBranch, GitCompare, GitPullRequest } from 'lucide-react';
import type { ComponentType } from 'react';
import { Badge } from '@/components/ui/badge';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import { useChatExtras } from '@/features/chat/runtime/chat-extras';
import { BranchPopover } from '@/features/git/BranchPopover';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDisplayBranch } from '@/features/sessions/use-display-branch';
import { activeSessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import { toChangesSummary, useWorkingChanges } from '@/features/review/use-working-changes';
import { useHost } from '@/lib/host';
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
  const host = useHost();
  const { projectId, chatId, branchName, isWorktree } = useActiveIdentity();
  // `refetch` is the popover-write path: a BranchPopover write broadcasts no
  // `chat.updated`, so nothing else invalidates the displayed branch.
  const { branch, isDraftWorktree, refetch } = useDisplayBranch({ port, projectId, chatId, branchName, isWorktree });
  const percent = useContextPercent();
  const usage = useChatExtras()?.state.contextUsage;
  const prs = useAuiState((s) => activeSessionCustom(s.threadListItem, s.threads.threadItems))?.detectedPrs ?? [];
  const changes = useWorkingChanges({ port, projectId, chatId });

  const rows = deriveSummaryRows({
    branch: { name: branch ?? null, isWorktree },
    context: { percent, usedTokens: usage?.totalTokens, maxTokens: usage?.maxTokens },
    prs,
    // Loading and error both mean "unknown", and a zero count would claim the
    // tree is clean. The row waits rather than lying.
    changes: projectId && !changes.loading && !changes.error ? toChangesSummary(changes) : null,
  });

  // No section heading of its own: the card header ("Session") names it, so
  // the rows start immediately.
  return (
    <section data-testid="session-panel-section-summary" className="shrink-0 border-b border-border">
      <div className="flex flex-col gap-0.5 py-2">
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
                onActivate={
                  row.kind === 'pr'
                    ? () => void host.shell.openExternal(row.url)
                    : row.kind === 'changes'
                      ? () => emitSurfaceIntent({ type: 'open-review' })
                      : undefined
                }
              />
            ),
          )
        )}
      </div>
    </section>
  );
}
