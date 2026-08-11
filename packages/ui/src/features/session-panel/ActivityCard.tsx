/**
 * ActivityCard — the live background work of this session: subagents,
 * background bash tasks, and workflow runs, as its own stacked panel.
 *
 * The daemon ships only running work (there is no status field on
 * `BackgroundActivityTask` — see background-task.ts), so every row IS running
 * and the count is the list length. The row's leading glyph says what KIND of
 * work it is — workflow, subagent, task — not its state; liveness is carried
 * by the ticking elapsed column and the rail button's pulse dot.
 *
 * A workflow row drills in place into its run panel — the level swap the
 * composer's two-level popover used to do, minus the popover.
 *
 * The section stays mounted across a session switch, so the drill-in is reset
 * on `chatId` explicitly; the popover got that free from Radix unmounting.
 *
 * Empty keeps one muted row: the rail's Activity button is a fixed affordance,
 * and a panel that vanishes when work finishes is worse than a placeholder.
 */
import { useEffect, useMemo, useState } from 'react';
import { Bot, ChevronLeft, ChevronRight, CircleDashed, Logs, SquareTerminal, Workflow } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { BackgroundActivityTask, BackgroundWorkKind, ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { useChatExtras } from '@/features/chat/runtime/use-chat-thread-runtime';
import { formatElapsed, useNow } from './background-activity-view';
import { useWorkflowRun } from '@/features/chat/workflow/use-workflow-run';
import { WorkflowRunPanel } from '@/features/chat/workflow/WorkflowRunPanel';
import { runKey } from '@/features/chat/workflow/workflow-progress';
import { runningCount } from './activity-view';
import { PanelCard } from './PanelCard';

const ROW = 'flex items-center gap-2 rounded-md px-2 py-1';
const ELAPSED = 'shrink-0 font-mono text-xs tabular-nums text-muted-foreground';

/** bash and unknown kinds both read as tasks, matching `summarizeByKind`. */
const KIND_LABEL: Record<BackgroundWorkKind, string> = {
  agent: 'Agent',
  bash: 'Task',
  workflow: 'Workflow',
  other: 'Task',
};

const KIND_ICON: Record<BackgroundWorkKind, LucideIcon> = {
  agent: Bot,
  bash: SquareTerminal,
  workflow: Workflow,
  other: CircleDashed,
};

function RowBody({
  kind,
  title,
  detail,
  startedAt,
  now,
}: {
  kind: BackgroundWorkKind;
  title: string;
  detail: string;
  startedAt: number;
  now: number;
}) {
  const Icon = KIND_ICON[kind] ?? CircleDashed;
  return (
    <>
      <Icon
        data-testid={`session-panel-kind-${kind}`}
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{detail}</div>
      </div>
      <span className={ELAPSED}>{formatElapsed(startedAt, now)}</span>
    </>
  );
}

function TaskRow({ task, now }: { task: BackgroundActivityTask; now: number }) {
  return (
    <div data-testid={`session-panel-task-${task.id}`} className={ROW}>
      <RowBody
        kind={task.kind}
        title={task.description || 'Background task'}
        detail={KIND_LABEL[task.kind] ?? 'Task'}
        startedAt={task.startedAt}
        now={now}
      />
    </div>
  );
}

/** The only row that opens something — and only once its run is known. */
function WorkflowRow({
  task,
  now,
  onOpen,
}: {
  task: BackgroundActivityTask;
  now: number;
  onOpen: (taskId: string) => void;
}) {
  const run = useWorkflowRun(task.id);
  if (!run) return <TaskRow task={task} now={now} />;

  const agents = run.agents.length;
  return (
    <button
      type="button"
      data-testid={`session-panel-workflow-${runKey(run)}`}
      onClick={() => onOpen(task.id)}
      className={cn(ROW, 'w-full text-left transition-colors hover:bg-foreground/8')}
    >
      <RowBody
        kind="workflow"
        title={run.workflowName ?? task.description ?? 'Workflow'}
        detail={`${agents} agent${agents === 1 ? '' : 's'}`}
        startedAt={task.startedAt}
        now={now}
      />
      <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

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

export function ActivityCard({ onClose }: { onClose: () => void }) {
  const extras = useChatExtras();
  const chatId = extras?.state.chatId;
  const backgroundTasks = extras?.state.backgroundTasks;
  const tasks = useMemo(() => Object.values(backgroundTasks ?? {}), [backgroundTasks]);
  const [drillTaskId, setDrillTaskId] = useState<string | null>(null);
  const drillRun = useWorkflowRun(drillTaskId ?? undefined);
  const now = useNow(tasks.length > 0);
  const running = runningCount(tasks);

  useEffect(() => setDrillTaskId(null), [chatId]);

  return (
    <PanelCard id="activity" label="Activity" icon={Logs} count={running > 0 ? running : undefined} onClose={onClose}>
      <div className="flex flex-col gap-0.5 p-2">
        {drillRun ? (
          <WorkflowDrillIn run={drillRun} onBack={() => setDrillTaskId(null)} />
        ) : tasks.length === 0 ? (
          <div data-testid="session-panel-activity-empty" className={cn(ROW, 'text-sm text-muted-foreground')}>
            Nothing running
          </div>
        ) : (
          tasks.map((task) =>
            task.kind === 'workflow' ? (
              <WorkflowRow key={task.id} task={task} now={now} onOpen={setDrillTaskId} />
            ) : (
              <TaskRow key={task.id} task={task} now={now} />
            ),
          )
        )}
      </div>
    </PanelCard>
  );
}
