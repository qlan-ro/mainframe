'use client';

/**
 * TaskProgressCard — tool card for the '_TaskProgress' synthetic tool.
 *
 * DEFAULT OPEN. Reduces a stream of TaskCreate/TaskUpdate tool items into a
 * todo checklist. Deleted tasks are filtered out. Returns null when no tasks
 * remain (e.g. all deleted before render).
 *
 * args shape: { items: TaskProgressItem[] }
 *   TaskProgressItem: { toolName, toolCallId, args, result, isError }
 *   TaskCreate args:  { subject }; result contains "Task #<id>" as a bare
 *     string or a daemon `ToolCallResult` `{ content, isError }`
 *   TaskUpdate args:  { taskId, status?, subject?, activeForm? }
 *
 * Renames apply from their turn onward — earlier cards keep the pre-rename
 * subject (each card is a point-in-time snapshot; retroactive renaming is
 * intentionally not done).
 */

import { useMemo } from 'react';
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { Check } from 'lucide-react';
import { extractTaskId } from '@qlan-ro/mainframe-types';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { TaskProgressItem } from '@/features/chat/view-model/message-meta';

// ── Internal types ────────────────────────────────────────────────────────────

interface TaskState {
  id: string;
  subject: string;
  status: string;
}

// ── Task reduction logic ──────────────────────────────────────────────────────

function reduceTaskItems(items: TaskProgressItem[]): TaskState[] {
  const list: TaskState[] = [];
  const map = new Map<string, TaskState>();
  // Monotonic counter (mirrors the core backfill's scope.nextId) — a
  // result-less streaming create falls back to this instead of `map.size + 1`,
  // which would collide with a real numeric id already in the map.
  let nextId = 1;

  for (const item of items) {
    if (item.toolName === 'TaskCreate') {
      const extracted = extractTaskId(item.result);
      const id = extracted ?? String(nextId);
      nextId = Math.max(nextId, Number(id)) + 1;
      const subject = (item.args['subject'] as string | undefined) ?? `Task #${id}`;
      const task: TaskState = { id, subject, status: 'pending' };
      map.set(id, task);
      list.push(task);
    } else if (item.toolName === 'TaskUpdate') {
      const taskId = (item.args['taskId'] as string | undefined) ?? '';
      const newStatus = (item.args['status'] as string | undefined) ?? '';
      const existing = map.get(taskId);
      if (existing) {
        if (newStatus) existing.status = newStatus;
        if (item.args['subject']) existing.subject = item.args['subject'] as string;
      } else if (taskId) {
        // Orphan update — its TaskCreate lives in an earlier message. The daemon
        // backfills the subject into args; fall back to the id only without it.
        const subject = (item.args['subject'] as string | undefined) ?? `Task #${taskId}`;
        const task: TaskState = { id: taskId, subject, status: newStatus || 'pending' };
        map.set(taskId, task);
        list.push(task);
      }
    }
  }

  return list.filter((t) => t.status !== 'deleted');
}

// ── Status icon ───────────────────────────────────────────────────────────────

function TaskStatusIcon({ status }: { status: string }) {
  if (status === 'completed') {
    return (
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border border-mf-success bg-mf-success">
        <Check size={10} className="text-background" strokeWidth={3} />
      </span>
    );
  }
  if (status === 'in_progress') {
    return <span className="h-3.5 w-3.5 shrink-0 animate-pulse rounded-sm border border-primary bg-primary" />;
  }
  // pending / unknown
  return <span className="h-3.5 w-3.5 shrink-0 rounded-sm border border-mf-text-3" />;
}

// ── Single task row ───────────────────────────────────────────────────────────

function TaskRow({ task }: { task: TaskState }) {
  const isCompleted = task.status === 'completed';
  const isInProgress = task.status === 'in_progress';

  return (
    <div data-testid={`chat-task-progress-item-${task.status}`} className="flex items-center gap-2 px-1 py-0.5">
      <TaskStatusIcon status={task.status} />
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'truncate text-body',
              isCompleted && 'text-muted-foreground line-through',
              isInProgress && 'text-foreground',
              !isCompleted && !isInProgress && 'text-muted-foreground',
            )}
            tabIndex={0}
          >
            {task.subject}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{task.subject}</TooltipContent>
      </Tooltip>
    </div>
  );
}

// ── TaskProgressCard ──────────────────────────────────────────────────────────

export const TaskProgressCard: ToolCallMessagePartComponent = (part) => {
  const items = (part.args['items'] as TaskProgressItem[] | undefined) ?? [];

  const tasks = useMemo(() => reduceTaskItems(items), [items]);

  if (tasks.length === 0) return null;

  return (
    <Collapsible data-testid="chat-task-progress-card" defaultOpen>
      <CollapsibleTrigger
        data-testid="chat-task-progress-toggle"
        className="flex w-full items-center gap-1.5 py-0.5 text-caption text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="font-medium">Tasks</span>
        <span className="text-mf-text-3">({tasks.length})</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-0.5 py-0.5">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

TaskProgressCard.displayName = 'TaskProgressCard';
