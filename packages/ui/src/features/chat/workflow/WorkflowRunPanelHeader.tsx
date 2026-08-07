/**
 * The run panel's header: tile, workflow name, status chip, progress summary and
 * the run's cumulative tokens/duration (D13). An unavailable run has nothing to
 * summarize, so it shows its run id instead (AC 19).
 */
import { Workflow } from 'lucide-react';
import type { ClaudeWorkflowRunStatus } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import type { ViewRun } from './workflow-agent-view';
import { formatRunDuration, formatRunTokens, runKey, statusChipLabel, summarizeRun } from './workflow-progress';

/** The semantic hue rides the tint, never the ink. */
const STATUS_CHIP: Record<ClaudeWorkflowRunStatus, string> = {
  running: 'bg-warning/10 text-foreground',
  completed: 'bg-success/10 text-foreground',
  failed: 'bg-destructive/10 text-foreground',
  stopped: 'bg-muted text-muted-foreground',
  paused: 'bg-muted text-muted-foreground',
  unavailable: 'bg-muted text-muted-foreground',
};

export function WorkflowRunPanelHeader({ run, now }: { run: ViewRun; now: number }) {
  const unavailable = run.status === 'unavailable';

  return (
    <header className="flex items-start gap-2.5 border-b border-border px-2.5 py-2.5">
      <span
        aria-hidden
        className="mt-px flex size-[22px] shrink-0 items-center justify-center rounded-sm bg-primary/10"
      >
        <Workflow size={12} className="text-primary" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-body font-semibold leading-tight text-foreground">
            {run.workflowName ?? 'Workflow'}
          </span>
          <span
            className={cn(
              'shrink-0 rounded-xs px-1 py-px text-caption font-medium leading-none',
              STATUS_CHIP[run.status],
            )}
          >
            {statusChipLabel(run.status)}
          </span>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
            {unavailable ? runKey(run) : summarizeRun(run, now)}
          </span>
          {!unavailable && (
            <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
              {formatRunTokens(run.totalTokens)} · {formatRunDuration(run.durationMs)}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
