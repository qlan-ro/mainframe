/** Live CLI work and unfinished delegated chats in the docked session panel. */
import { useEffect, useMemo, useState } from 'react';
import { useAui } from '@assistant-ui/react';
import { Bot, ChevronLeft, ChevronRight, CircleDashed, SquareTerminal, Workflow } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  isTerminalTaskStatus,
  type BackgroundActivityTask,
  type BackgroundWorkKind,
  type ClaudeWorkflowRun,
} from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { useChatExtras } from '@/features/chat/runtime/chat-extras';
import { formatElapsed, useNow } from './background-activity-view';
import { useWorkflowRun } from '@/features/chat/workflow/use-workflow-run';
import { WorkflowRunPanel } from '@/features/chat/workflow/WorkflowRunPanel';
import { runKey } from '@/features/chat/workflow/workflow-progress';
import { runningCount } from './activity-view';
import { PanelEyebrow } from './PanelEyebrow';
import { delegatedTasksOf, type DelegatedTaskRow } from '@/features/sessions/view-model/agent-provenance';
import { useSessionItems } from '@/features/chat/orchestration/use-session-items';
import { TaskStatusLabel } from '@/features/chat/orchestration/TaskStatusLabel';

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

function DelegatedRow({ task, onOpen }: { task: DelegatedTaskRow; onOpen: (itemId: string) => void }) {
  return (
    <button
      type="button"
      data-testid={`session-panel-delegated-${task.taskId}`}
      onClick={() => onOpen(task.itemId)}
      className={cn(ROW, 'w-full text-left transition-colors hover:bg-foreground/8')}
    >
      <Bot className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
      <TaskStatusLabel status={task.status} waiting={task.waiting} />
      <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
    </button>
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

export function ActivitySection() {
  const aui = useAui();
  const items = useSessionItems();
  const extras = useChatExtras();
  const chatId = extras?.state.chatId;
  const backgroundTasks = extras?.state.backgroundTasks;
  const tasks = useMemo(() => Object.values(backgroundTasks ?? {}), [backgroundTasks]);
  const delegated = useMemo(
    () => (chatId == null ? [] : delegatedTasksOf(items, chatId).filter((row) => !isTerminalTaskStatus(row.status))),
    [items, chatId],
  );
  const [drillTaskId, setDrillTaskId] = useState<string | null>(null);
  const drillRun = useWorkflowRun(drillTaskId ?? undefined);
  const now = useNow(tasks.length > 0);
  const running = runningCount(tasks) + delegated.filter((task) => task.status === 'running').length;
  const active = tasks.length + delegated.length;

  useEffect(() => setDrillTaskId(null), [chatId]);

  return (
    <section data-testid="session-panel-card-activity" className="shrink-0">
      <PanelEyebrow label="Activity" live={running > 0} liveTestId="session-panel-activity-live" />
      <div className="flex flex-col gap-0.5 px-2 pb-2">
        {drillRun ? (
          <WorkflowDrillIn run={drillRun} onBack={() => setDrillTaskId(null)} />
        ) : active === 0 ? (
          <div data-testid="session-panel-activity-empty" className={cn(ROW, 'text-sm text-muted-foreground')}>
            Nothing running
          </div>
        ) : (
          <>
            {delegated.map((task) => (
              <DelegatedRow key={task.taskId} task={task} onOpen={(id) => aui.threads.switchToThread(id)} />
            ))}
            {tasks.map((task) =>
              task.kind === 'workflow' ? (
                <WorkflowRow key={task.id} task={task} now={now} onOpen={setDrillTaskId} />
              ) : (
                <TaskRow key={task.id} task={task} now={now} />
              ),
            )}
          </>
        )}
      </div>
    </section>
  );
}
