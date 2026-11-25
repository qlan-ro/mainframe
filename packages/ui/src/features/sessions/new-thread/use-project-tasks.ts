/** The project's newest open tasks for a new session's empty state (K11). */
import { useCallback, useEffect, useState } from 'react';
import type { Todo } from '@/lib/api/todos';
import { newestFirst } from '@/features/tasks/todos-filters';
import { projectTodosKey, useTodosStore } from '@/features/tasks/use-todos-store';

const SHOWN = 3;

export interface ProjectTasks {
  tasks: readonly Todo[];
  /** Only with nothing to show: a list that failed to refresh still shows what it has. */
  state: 'ready' | 'loading' | 'failed';
  reload: () => void;
}

/** A task someone already works on is not one to start. */
export function tasksToStart(todos: readonly Todo[]): Todo[] {
  return newestFirst(todos.filter((todo) => todo.status === 'open')).slice(0, SHOWN);
}

export function useProjectTasks(port: number, projectId: string | null): ProjectTasks {
  const load = useTodosStore((s) => s.load);
  const key = projectId == null ? undefined : projectTodosKey(projectId);
  const entry = useTodosStore((s) => (key === undefined ? undefined : s.entries[key]));
  // The store cannot tell an empty list from one not loaded yet, and the panel
  // reloads it too: only the first answer for a project ends its loading.
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const reload = useCallback(() => {
    if (projectId == null || key !== projectTodosKey(projectId)) return;
    void load(port, projectId).then(() => setAnswered((prev) => new Set(prev).add(key)));
  }, [load, port, projectId, key]);
  useEffect(reload, [reload]);

  const tasks = tasksToStart(entry?.todos ?? []);
  if (key === undefined || tasks.length > 0) return { tasks, state: 'ready', reload };
  if (entry?.error != null) return { tasks, state: 'failed', reload };
  return { tasks, state: answered.has(key) ? 'ready' : 'loading', reload };
}
