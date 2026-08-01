/**
 * The activity popover's two levels (AC 5, 6): the list the chip has always shown,
 * and one workflow's run panel, reached by clicking its row and left by the panel's
 * breadcrumb. Subagent and bash entries stay inert — there is nothing to drill into.
 *
 * The level lives here rather than in the bar because Radix unmounts the content on
 * close, which resets it to the list for free.
 */
import { useState } from 'react';
import { Bot, ChevronRight, SquareTerminal, Workflow } from 'lucide-react';
import type { BackgroundActivityTask, BackgroundWorkKind } from '@qlan-ro/mainframe-types';
import { PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useWorkflowRun } from '../workflow/use-workflow-run';
import { WorkflowRunPanel } from '../workflow/WorkflowRunPanel';
import { formatElapsed } from './background-activity-view';

const KIND_ICONS: Record<BackgroundWorkKind, typeof Bot> = {
  agent: Bot,
  bash: SquareTerminal,
  workflow: Workflow,
  other: SquareTerminal,
};

const ROW = 'flex items-center gap-2 rounded-md px-2 py-1.5';

function TaskRow({ task, now }: { task: BackgroundActivityTask; now: number }) {
  const Icon = KIND_ICONS[task.kind] ?? SquareTerminal;
  return (
    <li data-testid={`composer-background-activity-item-${task.id}`} className={ROW}>
      <Icon size={14} className="flex-shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-caption text-foreground">
        {task.description || 'Background task'}
      </span>
      <span className="flex-shrink-0 font-mono text-caption tabular-nums text-muted-foreground">
        {formatElapsed(task.startedAt, now)}
      </span>
    </li>
  );
}

/** A live workflow: the only row that opens something. */
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
    <li>
      <button
        type="button"
        onClick={() => onOpen(task.id)}
        data-testid={`chat-background-workflow-${run.runId ?? task.id}`}
        className={cn(ROW, 'w-full cursor-pointer text-left transition-colors hover:bg-accent')}
      >
        <Workflow size={14} className="flex-shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-caption text-foreground">
          {run.workflowName ?? (task.description || 'Workflow')}
        </span>
        <span className="flex-shrink-0 text-caption tabular-nums text-muted-foreground">
          {agents} agent{agents === 1 ? '' : 's'}
        </span>
        <ChevronRight size={12} className="flex-shrink-0 text-mf-text-3" aria-hidden />
      </button>
    </li>
  );
}

export function WorkflowActivityPopover({ tasks, now }: { tasks: BackgroundActivityTask[]; now: number }) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedRun = useWorkflowRun(selectedTaskId ?? undefined);
  const level = selectedRun ? 'run' : 'list';

  return (
    <PopoverContent
      align="start"
      side="top"
      onOpenAutoFocus={(event) => event.preventDefault()}
      className={cn('p-0 transition-[width] duration-150', level === 'list' ? 'w-80' : 'w-[380px]')}
    >
      {selectedRun ? (
        <WorkflowRunPanel run={selectedRun} onBack={() => setSelectedTaskId(null)} />
      ) : (
        <ul className="flex max-h-56 flex-col gap-px overflow-y-auto p-1">
          {tasks.map((task) =>
            task.kind === 'workflow' ? (
              <WorkflowRow key={task.id} task={task} now={now} onOpen={setSelectedTaskId} />
            ) : (
              <TaskRow key={task.id} task={task} now={now} />
            ),
          )}
        </ul>
      )}
    </PopoverContent>
  );
}
