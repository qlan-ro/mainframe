/**
 * The `Workflow` / `RunWorkflow` tool call in the transcript: one collapsed row,
 * never an expanding card. It is the permanent record of the launch — clicking it
 * opens the same run panel the background-activity popover shows, anchored to
 * itself and without the breadcrumb (AC 1-4).
 *
 * A launch that never produced a run id (a failure, or a call still in flight) has
 * no panel to open, so those rows are inert.
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { ChevronRight, Workflow } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { resolveResultText } from '../tools/shared';
import { neutralizedRun } from './workflow-agent-view';
import { outcomeDot, parseWorkflowLaunch, runMetaString, unavailableRun, type OutcomeDot } from './workflow-progress';
import { useWorkflowRun } from './use-workflow-run';
import { WorkflowRunPanel } from './WorkflowRunPanel';

const ROW = 'flex w-full items-center gap-[9px] rounded-lg border border-border bg-card px-[10px] py-[7px] text-left';

const DOT_FILL: Record<string, string> = {
  green: 'bg-success',
  amber: 'bg-warning',
  red: 'bg-destructive',
  hollow: 'border border-muted-foreground',
};

function LauncherDot({ tone, pulse }: OutcomeDot) {
  return (
    <span
      aria-hidden
      data-testid="chat-workflow-launcher-dot"
      data-tone={tone}
      data-pulse={String(pulse)}
      className={cn('size-2 shrink-0 rounded-full', DOT_FILL[tone], pulse && 'motion-safe:animate-pulse')}
    />
  );
}

function LauncherTile() {
  return (
    <span
      aria-hidden
      className="flex size-[22px] shrink-0 items-center justify-center rounded-sm bg-primary/10 text-primary"
    >
      <Workflow size={12} />
    </span>
  );
}

/** A launch with no run behind it: same shell, nothing to open. */
function InertRow({
  testId,
  dot,
  name,
  detail,
  detailClass,
}: {
  testId: string;
  dot: OutcomeDot;
  name: string;
  detail: string;
  detailClass?: string;
}) {
  return (
    <div data-testid={testId} className={ROW}>
      <LauncherTile />
      <LauncherDot {...dot} />
      <span className="shrink-0 text-label font-medium text-foreground">{name}</span>
      <span className={cn('min-w-0 flex-1 truncate text-caption text-muted-foreground', detailClass)}>{detail}</span>
    </div>
  );
}

export const WorkflowLauncherRow: ToolCallMessagePartComponent = ({ toolCallId, result }) => {
  const launch = parseWorkflowLaunch(resolveResultText(result).text);
  const run = useWorkflowRun(launch.taskId);
  const name = launch.workflowName ?? run?.workflowName ?? 'Workflow';

  if (launch.error) {
    return (
      <InertRow
        testId={`chat-workflow-launcher-${toolCallId}`}
        dot={{ tone: 'red', pulse: false }}
        name={name}
        detail={launch.error}
        detailClass="text-destructive"
      />
    );
  }

  if (!launch.runId) {
    const pending = result === undefined || result === null;
    return (
      <InertRow
        testId={`chat-workflow-launcher-${toolCallId}`}
        dot={{ tone: pending ? 'amber' : 'hollow', pulse: pending }}
        name={name}
        detail={pending ? 'Starting…' : 'No run details reported'}
      />
    );
  }

  const now = Date.now();
  const effective = run ?? unavailableRun(launch);
  const view = neutralizedRun(effective, now);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`chat-workflow-launcher-${launch.runId}`}
          className={cn(ROW, 'cursor-pointer transition-colors hover:border-input hover:bg-accent')}
        >
          <LauncherTile />
          <LauncherDot {...outcomeDot(view, now)} />
          <span className="min-w-0 flex-1 truncate text-label font-medium text-foreground">{name}</span>
          <span className="shrink-0 text-caption tabular-nums text-muted-foreground">{runMetaString(view, now)}</span>
          <ChevronRight size={12} className="shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[380px] p-0" onOpenAutoFocus={(event) => event.preventDefault()}>
        <WorkflowRunPanel run={effective} />
      </PopoverContent>
    </Popover>
  );
};
