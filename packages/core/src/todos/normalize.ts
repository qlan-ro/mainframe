// packages/core/src/todos/normalize.ts
import type { TodoItem } from '@qlan-ro/mainframe-types';

/** The three sources that can produce a TodoItem list. */
export type TodoSource = 'todoV1' | 'taskV2' | 'codexTodoList';

/**
 * A single V2 task event (TaskCreate, TaskUpdate, TaskStop) used as input
 * to the taskV2 normalizer. Shape mirrors TaskProgressItem from tool-grouping.
 */
export interface TaskV2Event {
  toolName: 'TaskCreate' | 'TaskUpdate' | 'TaskStop' | 'TaskList';
  args: Record<string, unknown>;
  result?: unknown;
}

/** Internal mutable task state used while accumulating V2 events. */
interface TaskState {
  id: string;
  subject: string;
  status: string;
  activeForm: string;
}

/**
 * Normalize raw payload from a given source into a canonical TodoItem[].
 *
 * - 'todoV1': payload is the TodoWrite.todos array (already TodoItem-shaped).
 * - 'taskV2': payload is an ordered array of TaskV2Event from TaskCreate / TaskUpdate / TaskStop.
 *   Accumulates progressive state into a snapshot of current tasks.
 * - 'codexTodoList': payload is Codex TodoListItem.items ({ text, completed }[]).
 */
export function normalizeTodos(source: TodoSource, payload: unknown): TodoItem[] {
  switch (source) {
    case 'todoV1':
      return normalizeTodoV1(payload);
    case 'taskV2':
      return normalizeTaskV2(payload);
    case 'codexTodoList':
      return normalizeCodexTodoList(payload);
  }
}

function normalizeTodoV1(payload: unknown): TodoItem[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter(
    (t): t is TodoItem =>
      typeof t === 'object' &&
      t !== null &&
      typeof (t as Record<string, unknown>).content === 'string' &&
      typeof (t as Record<string, unknown>).status === 'string',
  );
}

function normalizeTaskV2(payload: unknown): TodoItem[] {
  if (!Array.isArray(payload)) return [];
  const events = payload as TaskV2Event[];

  const list: TaskState[] = [];
  const map = new Map<string, TaskState>();

  for (const event of events) {
    if (event.toolName === 'TaskCreate') {
      const resultStr = typeof event.result === 'string' ? event.result : '';
      const match = resultStr.match(/Task #(\d+)/);
      const id = match ? match[1]! : String(map.size + 1);
      const subject = (event.args.subject as string) || `Task #${id}`;
      const activeForm = (event.args.activeForm as string) || subject;
      const task: TaskState = { id, subject, status: 'pending', activeForm };
      map.set(id, task);
      list.push(task);
    } else if (event.toolName === 'TaskUpdate') {
      const taskId = (event.args.taskId as string) || '';
      const newStatus = (event.args.status as string) || '';
      const existing = map.get(taskId);
      if (existing) {
        if (newStatus) existing.status = newStatus;
        if (event.args.subject) existing.subject = event.args.subject as string;
        if (event.args.activeForm) existing.activeForm = event.args.activeForm as string;
      } else if (taskId) {
        const subject = (event.args.subject as string) || `Task #${taskId}`;
        const task: TaskState = { id: taskId, subject, status: newStatus || 'pending', activeForm: subject };
        map.set(taskId, task);
        list.push(task);
      }
    } else if (event.toolName === 'TaskStop') {
      const taskId = (event.args.taskId as string) || '';
      const existing = map.get(taskId);
      if (existing) existing.status = 'deleted';
    }
  }

  return list
    .filter((t) => t.status !== 'deleted')
    .map((t) => ({
      content: t.subject,
      status: taskStatusToTodoStatus(t.status),
      activeForm: t.activeForm,
    }));
}

function taskStatusToTodoStatus(status: string): TodoItem['status'] {
  if (status === 'completed') return 'completed';
  if (status === 'in_progress') return 'in_progress';
  return 'pending';
}

function normalizeCodexTodoList(payload: unknown): TodoItem[] {
  if (!Array.isArray(payload)) return [];
  return (payload as Array<{ text: string; completed: boolean }>)
    .filter((t) => typeof t.text === 'string')
    .map((t) => ({
      content: t.text,
      status: t.completed ? ('completed' as const) : ('pending' as const),
      activeForm: t.text,
    }));
}
