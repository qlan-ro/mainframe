/**
 * ActivityCard — the live and just-finished background work of this session:
 * subagents, background bash tasks, Monitor-tool watchers, and workflow runs,
 * as its own stacked panel.
 *
 * Every row carries a state: running, stopping, stop-error, or a terminal
 * status (completed/failed/stopped). Terminal rows stay listed — dismissed by
 * the user, cleared at the next turn, or capped at 5 — so the panel reads as
 * a short record of the turn's background work, not only a live gauge. The
 * count badge, the rail badge and "N tasks running" all count running (and
 * stopping) rows only, via `runningCount` (todo #328).
 *
 * A workflow row with a known run drills into its run panel; every other row
 * (and a workflow row whose run isn't known yet) drills into `ActivityDetail`.
 * Both level swaps share one `drillTaskId` and the panel's list is what's left
 * when neither resolves — a row leaving the list returns the view to the list
 * on its own.
 *
 * The section stays mounted across a session switch, so the drill-in is reset
 * on `chatId` explicitly; the popover got that free from Radix unmounting.
 *
 * Empty keeps one muted row: the rail's Activity button is a fixed affordance,
 * and a panel that vanishes when work finishes is worse than a placeholder.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Logs } from 'lucide-react';
import type { BackgroundActivityTask, ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { useChatExtras } from '@/features/chat/runtime/chat-extras';
import { useAdapters } from '@/store/adapters';
import { useNow } from './background-activity-view';
import { useWorkflowRun } from '@/features/chat/workflow/use-workflow-run';
import { WorkflowRunPanel } from '@/features/chat/workflow/WorkflowRunPanel';
import { runKey } from '@/features/chat/workflow/workflow-progress';
import { orderRows, runningCount } from './activity-view';
import { ActivityRow } from './ActivityRow';
import { ActivityDetail } from './ActivityDetail';
import { PanelCard } from './PanelCard';

const ROW = 'flex items-center gap-2 rounded-md px-2 py-1';

/** Level two: one run's panel, with the way back to the list. */
function WorkflowDrillIn({ run, onBack }: { run: ClaudeWorkflowRun; onBack: () => void }) {
  return (
    <>
      <button
        type="button"
        data-testid={`session-panel-workflow-back-${runKey(run)}`}
        onClick={onBack}
        className="flex items-center gap-1 self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-3" aria-hidden />
        Activity
      </button>
      <WorkflowRunPanel run={run} />
    </>
  );
}

interface RowListProps {
  tasks: BackgroundActivityTask[];
  now: number;
  extras: NonNullable<ReturnType<typeof useChatExtras>>;
  stopSupported: boolean;
  unsupportedReason: string | undefined;
  onOpen: (taskId: string) => void;
}

/** One row per task; a `workflow` kind resolves its run via its own hook instance. */
function RowList({ tasks, now, extras, stopSupported, unsupportedReason, onOpen }: RowListProps) {
  return (
    <>
      {tasks.map((task) =>
        task.kind === 'workflow' ? (
          <ActivityWorkflowRow
            key={task.id}
            task={task}
            now={now}
            extras={extras}
            stopSupported={stopSupported}
            unsupportedReason={unsupportedReason}
            onOpen={onOpen}
          />
        ) : (
          <ActivityRow
            key={task.id}
            task={task}
            now={now}
            stop={extras.state.backgroundStops[task.id]}
            workflowRun={undefined}
            stopSupported={stopSupported}
            unsupportedReason={unsupportedReason}
            onOpen={onOpen}
            onStop={extras.stopBackgroundTask}
            onDismiss={extras.dismissBackgroundTask}
          />
        ),
      )}
    </>
  );
}

/** Split out only so `useWorkflowRun` — one hook per task — has its own component instance. */
function ActivityWorkflowRow({
  task,
  now,
  extras,
  stopSupported,
  unsupportedReason,
  onOpen,
}: {
  task: BackgroundActivityTask;
  now: number;
  extras: NonNullable<ReturnType<typeof useChatExtras>>;
  stopSupported: boolean;
  unsupportedReason: string | undefined;
  onOpen: (taskId: string) => void;
}) {
  const run = useWorkflowRun(task.id);
  return (
    <ActivityRow
      task={task}
      now={now}
      stop={extras.state.backgroundStops[task.id]}
      workflowRun={run}
      stopSupported={stopSupported}
      unsupportedReason={unsupportedReason}
      onOpen={onOpen}
      onStop={extras.stopBackgroundTask}
      onDismiss={extras.dismissBackgroundTask}
    />
  );
}

export function ActivityCard({ onClose }: { onClose: () => void }) {
  const extras = useChatExtras();
  const adapters = useAdapters();
  const chatId = extras?.state.chatId;
  const backgroundTasks = extras?.state.backgroundTasks;
  const tasks = useMemo(() => orderRows(Object.values(backgroundTasks ?? {})), [backgroundTasks]);
  const [drillTaskId, setDrillTaskId] = useState<string | null>(null);
  const drillRun = useWorkflowRun(drillTaskId ?? undefined);
  const drillTask = tasks.find((task) => task.id === drillTaskId);
  const now = useNow(tasks.length > 0);
  const running = runningCount(tasks);

  const adapterId = extras?.state.chatConfig?.adapterId;
  const adapter = adapters.find((a) => a.id === adapterId);
  const stopSupported = adapter?.capabilities.stopBackgroundTask === true;
  const unsupportedReason = stopSupported
    ? undefined
    : `Stopping background tasks isn't supported for ${adapter?.name ?? 'this'} sessions.`;

  useEffect(() => setDrillTaskId(null), [chatId]);

  return (
    <PanelCard id="activity" label="Activity" icon={Logs} count={running > 0 ? running : undefined} onClose={onClose}>
      <div className="flex flex-col gap-0.5 p-2">
        {drillRun ? (
          <WorkflowDrillIn run={drillRun} onBack={() => setDrillTaskId(null)} />
        ) : drillTask ? (
          <ActivityDetail
            task={drillTask}
            now={now}
            stop={extras?.state.backgroundStops[drillTask.id]}
            chatId={chatId}
            onBack={() => setDrillTaskId(null)}
          />
        ) : tasks.length === 0 ? (
          <div data-testid="session-panel-activity-empty" className={cn(ROW, 'text-sm text-muted-foreground')}>
            Nothing running
          </div>
        ) : extras ? (
          <RowList
            tasks={tasks}
            now={now}
            extras={extras}
            stopSupported={stopSupported}
            unsupportedReason={unsupportedReason}
            onOpen={setDrillTaskId}
          />
        ) : null}
      </div>
    </PanelCard>
  );
}
