/**
 * ActivitySection — the live background work of this session: subagents,
 * background bash tasks, and workflow runs.
 *
 * The daemon ships only running work (there is no status field on
 * `BackgroundActivityTask`), so every row spins and the count IS the list
 * length. A workflow row drills in place into its run panel — the level swap
 * the composer's two-level popover used to do, minus the popover.
 *
 * The section stays mounted across a session switch, so the drill-in is reset
 * on `chatId` explicitly; the popover got that free from Radix unmounting.
 *
 * Empty keeps the header and one muted row: the rail's Activity button is a
 * fixed affordance, and a scroll target that vanishes when work finishes is
 * worse than a placeholder.
 */
import { useEffect, useMemo, useState } from 'react';
import { Activity, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react';
import type { BackgroundActivityTask, BackgroundWorkKind, ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import { cn } from '@v2/lib/utils';
import { useChatExtras } from '@/features/chat/runtime/use-chat-thread-runtime';
import { formatElapsed, useNow } from './background-activity-view';
import { useWorkflowRun } from '@/features/chat/workflow/use-workflow-run';
import { WorkflowRunPanel } from '@/features/chat/workflow/WorkflowRunPanel';
import { runKey } from '@/features/chat/workflow/workflow-progress';
import { runningCount } from './activity-view';
import { PanelSection } from './PanelSection';

const ROW = 'flex items-center gap-2 rounded-md bg-muted px-2 py-1.5';
const ELAPSED = 'shrink-0 font-mono text-xs tabular-nums text-muted-foreground';

/** bash and unknown kinds both read as tasks, matching `summarizeByKind`. */
const KIND_LABEL: Record<BackgroundWorkKind, string> = {
  agent: 'Agent',
  bash: 'Task',
  workflow: 'Workflow',
  other: 'Task',
};

function RowBody({ title, detail, startedAt, now }: { title: string; detail: string; startedAt: number; now: number }) {
  return (
    <>
      <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden />
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
      className={cn(ROW, 'w-full text-left transition-colors hover:bg-accent')}
    >
      <RowBody
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
        Background Activity
      </button>
      <WorkflowRunPanel run={run} />
    </>
  );
}

interface ActivitySectionProps {
  open: boolean;
  onToggle: () => void;
  sectionRef?: (el: HTMLElement | null) => void;
}

export function ActivitySection({ open, onToggle, sectionRef }: ActivitySectionProps) {
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
    <PanelSection
      id="activity"
      label="Background Activity"
      icon={Activity}
      count={running > 0 ? running : undefined}
      open={open}
      onToggle={onToggle}
      sectionRef={sectionRef}
    >
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
    </PanelSection>
  );
}
