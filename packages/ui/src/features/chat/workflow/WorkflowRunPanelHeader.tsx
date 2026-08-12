/**
 * The run panel's header answers "where is it and how far" in one glance:
 * name + status pill, a segmented per-phase progress rail, then the current
 * phase and the run counters (done/total phases · tokens · elapsed). An
 * unavailable run has nothing to chart, so it shows its run id instead (AC 19);
 * a phase-less run falls back to the old agent-count summary.
 */
import type { ClaudeWorkflowRunStatus } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import type { ViewRun } from './workflow-agent-view';
import { formatRunDuration, formatRunTokens, runKey, statusChipLabel, summarizeRun } from './workflow-progress';
import { currentPhase, donePhaseCount, runTimeline, type PhaseStatus, type RunTimeline } from './workflow-phase-view';

/** The semantic hue rides the tint (and the running dot), never the ink. */
const PILL_TINT: Record<ClaudeWorkflowRunStatus, string> = {
  running: 'bg-primary/10 text-foreground',
  completed: 'bg-success/10 text-foreground',
  failed: 'bg-destructive/10 text-foreground',
  stopped: 'bg-muted text-muted-foreground',
  paused: 'bg-muted text-muted-foreground',
  unavailable: 'bg-muted text-muted-foreground',
};

const RAIL_FILL: Record<PhaseStatus, string> = {
  done: 'bg-success',
  failed: 'bg-destructive',
  running: 'bg-primary motion-safe:animate-pulse',
  unknown: 'bg-muted-foreground/40',
  pending: 'bg-muted',
};

function StatusPill({ status }: { status: ClaudeWorkflowRunStatus }) {
  return (
    <span
      data-testid="chat-workflow-status-pill"
      className={cn(
        'flex h-4.5 shrink-0 items-center gap-1 rounded-full px-1.5 text-xs font-medium',
        PILL_TINT[status],
      )}
    >
      {status === 'running' && (
        <span aria-hidden className="size-1 rounded-full bg-primary motion-safe:animate-pulse" />
      )}
      {statusChipLabel(status)}
    </span>
  );
}

/** One thin segment per phase — the whole run's shape in 3px. */
function ProgressRail({ timeline }: { timeline: RunTimeline }) {
  return (
    <div data-testid="chat-workflow-rail" className="mt-1.5 flex gap-0.5">
      {timeline.all.map((view) => (
        <Hint key={view.phase.index} label={view.phase.title}>
          <span
            data-status={view.status}
            className={cn('h-[3px] min-w-0 flex-1 rounded-full', RAIL_FILL[view.status])}
          />
        </Hint>
      ))}
    </div>
  );
}

function progressLine(run: ViewRun, timeline: RunTimeline, now: number): string {
  if (timeline.all.length === 0) return summarizeRun(run, now);
  const current = currentPhase(timeline);
  if (current) {
    const live = current.agents.filter((agent) => agent.state === 'start' || agent.state === 'progress').length;
    return live > 0 ? `${current.phase.title} · ${live} running` : current.phase.title;
  }
  if (run.status === 'completed') return 'All phases complete';
  const deepest = timeline.shown[timeline.shown.length - 1];
  return deepest?.phase.title ?? 'Waiting to start';
}

export function WorkflowRunPanelHeader({ run, now }: { run: ViewRun; now: number }) {
  const unavailable = run.status === 'unavailable';
  const timeline = runTimeline(run);
  const hasPhases = timeline.all.length > 0;

  const meta: string[] = [];
  if (hasPhases) meta.push(`${donePhaseCount(timeline)}/${timeline.all.length}`);
  if (run.agents.length > 0) meta.push(formatRunTokens(run.totalTokens), formatRunDuration(run.durationMs));

  return (
    <header className="border-b border-border px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-sm leading-tight font-semibold text-foreground">
          {run.workflowName ?? 'Workflow'}
        </span>
        <StatusPill status={run.status} />
      </div>
      {!unavailable && hasPhases && <ProgressRail timeline={timeline} />}
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {unavailable ? runKey(run) : progressLine(run, timeline, now)}
        </span>
        {!unavailable && meta.length > 0 && (
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{meta.join(' · ')}</span>
        )}
      </div>
    </header>
  );
}
