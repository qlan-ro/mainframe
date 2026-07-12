/**
 * TasksDrawerList — compact task rows inside the Inspector drawer.
 *
 * SINGLE loader owner: installs the project-scoped useTodosStore.load() effect
 * (loads on mount + on projectId change). The full modal (TasksBoard) reuses
 * this cached state without a competing load effect.
 *
 * Filters to active tasks (status !== 'done'). Click → opens TaskEditModal
 * via local state (drawer-local; does not use the modal store).
 *
 * data-testid="tasks-drawer-row-${number}".
 */
import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useTodosStore } from './use-todos-store';
import { TaskEditModal } from './TaskEditModal';
import { statusDotColor } from './task-palettes';
import type { Todo } from '@/lib/api/todos';
import { extractAllLabels } from './todos-filters';

interface Props {
  port: number;
  projectId: string;
  onStartSession: (todo: Todo) => void; // required; caller passes useStartTodoSession result
}

export function TasksDrawerList({ port, projectId, onStartSession }: Props): React.ReactElement {
  const { load, todos } = useTodosStore();
  const [editTodo, setEditTodo] = useState<Todo | null | undefined>(undefined);

  // SINGLE loader owner: this component is always mounted when projectId is set.
  useEffect(() => {
    void load(port, projectId);
  }, [port, projectId, load]);

  const active = todos.filter((t) => t.status !== 'done');
  const allLabels = extractAllLabels(todos);

  return (
    <>
      <div className="flex flex-col overflow-y-auto min-h-0">
        {active.length === 0 ? (
          <div data-testid="tasks-drawer-empty" className="px-3 py-4 text-caption text-muted-foreground">
            No active tasks.
          </div>
        ) : (
          active.map((todo) => (
            <button
              key={todo.id}
              type="button"
              data-testid={`tasks-drawer-row-${todo.number}`}
              onClick={() => setEditTodo(todo)}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors',
                'border-b border-border last:border-b-0',
              )}
            >
              <span className={cn('shrink-0 w-1.5 h-1.5 rounded-full', statusDotColor(todo.status))} />
              <span className="shrink-0 font-mono text-label text-primary">#{todo.number}</span>
              <span className="flex-1 min-w-0 text-body text-foreground truncate">{todo.title}</span>
            </button>
          ))
        )}
      </div>

      {/* Drawer-local edit modal */}
      {editTodo !== undefined && (
        <TaskEditModal
          port={port}
          projectId={projectId}
          todo={editTodo}
          allTodos={todos}
          allLabels={allLabels}
          onClose={() => setEditTodo(undefined)}
          onStartSession={(id) => {
            const todo = todos.find((t) => t.id === id);
            if (todo) onStartSession(todo);
            setEditTodo(undefined);
          }}
        />
      )}
    </>
  );
}
