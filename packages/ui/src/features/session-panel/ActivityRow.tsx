/**
 * ActivityRow — one Activity list row: a full-width open button (drills into
 * the task's detail, or a known workflow's run panel) plus the trailing slot
 * sibling. Siblings, not nested buttons — nested interactive elements are
 * invalid HTML, which is why the stop/dismiss controls live beside the open
 * button rather than inside it.
 */
import type { ReactNode } from 'react';
import type { BackgroundActivityTask, ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import type { BackgroundStopState } from '@/features/chat/controller/background-activity-state';
import { runKey } from '@/features/chat/workflow/workflow-progress';
import { ACTIVITY_KIND_ICON, activityLabel, rowState, statusLabel, statusTone } from './activity-kinds';
import { activityKind } from './activity-view';
import { ActivityTrailingSlot } from './ActivityTrailingSlot';

const ROW = 'group flex items-center gap-2 rounded-md px-2 py-1';
const OPEN_BUTTON =
  '-m-1 flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-foreground/8';

function secondLine(
  task: BackgroundActivityTask,
  state: ReturnType<typeof rowState>,
  workflowRun: ClaudeWorkflowRun | undefined,
): ReactNode {
  if (state === 'stopping') return 'Stopping…';
  if (state === 'completed' || state === 'failed' || state === 'stopped') {
    return (
      <>
        {activityLabel(task)} · <span className={statusTone(state)}>{statusLabel(state)}</span>
      </>
    );
  }
  if (workflowRun !== undefined) {
    const agents = workflowRun.agents.length;
    return `${agents} agent${agents === 1 ? '' : 's'}`;
  }
  return activityLabel(task);
}

export interface ActivityRowProps {
  task: BackgroundActivityTask;
  now: number;
  stop: BackgroundStopState | undefined;
  /** Set only for a `workflow` task whose run the client has already resolved. */
  workflowRun: ClaudeWorkflowRun | undefined;
  stopSupported: boolean;
  unsupportedReason: string | undefined;
  onOpen: (taskId: string) => void;
  onStop: (taskId: string) => void;
  onDismiss: (taskId: string) => void;
}

export function ActivityRow({
  task,
  now,
  stop,
  workflowRun,
  stopSupported,
  unsupportedReason,
  onOpen,
  onStop,
  onDismiss,
}: ActivityRowProps) {
  const state = rowState(task, stop);
  const kind = activityKind(task);
  const Icon = ACTIVITY_KIND_ICON[kind];
  const title =
    workflowRun !== undefined
      ? (workflowRun.workflowName ?? task.description ?? 'Workflow')
      : task.description || 'Background task';
  const openTestId =
    workflowRun !== undefined ? `session-panel-workflow-${runKey(workflowRun)}` : `activity-drill-open-${task.id}`;

  return (
    <div data-testid={`session-panel-task-${task.id}`} className={ROW}>
      <button type="button" data-testid={openTestId} onClick={() => onOpen(task.id)} className={OPEN_BUTTON}>
        <Icon
          data-testid={`session-panel-kind-${kind}`}
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{title}</div>
          <div className="truncate text-xs text-muted-foreground">{secondLine(task, state, workflowRun)}</div>
        </div>
      </button>
      <ActivityTrailingSlot
        task={task}
        now={now}
        state={state}
        stopMessage={stop?.phase === 'error' ? stop.message : undefined}
        stopSupported={stopSupported}
        unsupportedReason={unsupportedReason}
        onStop={() => onStop(task.id)}
        onDismiss={() => onDismiss(task.id)}
      />
    </div>
  );
}
