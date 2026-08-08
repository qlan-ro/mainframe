/**
 * The task rows for the sidebar section, and the edit modal they open.
 *
 * Sole owner of the project-scoped load effect: the section is always mounted
 * while a project is active, and the store's own sequence guard makes a second
 * loader (the board modal, once it exists) harmless rather than racy.
 *
 * The list caps itself rather than scrolling — the panel keeps one scroller,
 * which the sessions list already owns.
 */
import { useEffect, useState } from 'react';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import type { Todo } from '@/lib/api/todos';
import { useTodosStore } from '@/features/tasks/use-todos-store';
import { extractAllLabels } from '@/features/tasks/todos-filters';
import { TaskEditModal } from './TaskEditModal';

const ROW_INDENT = 'pl-5';

/** A preview, not the backlog; the rest lives in the full Tasks view. */
const VISIBLE_TASKS = 5;

interface TasksSidebarListProps {
  port: number;
  projectId: string;
  onStartSession: (todo: Todo) => void;
}

export function TasksSidebarList({ port, projectId, onStartSession }: TasksSidebarListProps) {
  const { load, todos } = useTodosStore();
  // `undefined` is closed; `null` would be the create form, which the section owns.
  const [editTodo, setEditTodo] = useState<Todo | undefined>(undefined);

  useEffect(() => {
    void load(port, projectId);
  }, [port, projectId, load]);

  const active = todos.filter((t) => t.status !== 'done');

  return (
    <>
      {active.length === 0 ? (
        <SidebarMenuItem>
          <div data-testid="tasks-sidebar-empty" className={`${ROW_INDENT} py-1 text-xs text-muted-foreground`}>
            No active tasks
          </div>
        </SidebarMenuItem>
      ) : (
        active.slice(0, VISIBLE_TASKS).map((todo) => (
          <SidebarMenuItem key={todo.id}>
            <SidebarMenuButton
              data-testid={`tasks-sidebar-row-${todo.number}`}
              size="sm"
              tooltip={todo.title}
              onClick={() => setEditTodo(todo)}
              className={ROW_INDENT}
            >
              <span className="shrink-0 text-primary">#{todo.number}</span>
              <span className="min-w-0 flex-1 truncate-fade text-muted-foreground">{todo.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))
      )}

      {active.length > VISIBLE_TASKS && (
        <SidebarMenuItem>
          {/* Static, not a link: the full Tasks view has no host in v2 yet. */}
          <div data-testid="tasks-sidebar-overflow" className={`${ROW_INDENT} py-1 text-xs text-muted-foreground`}>
            {active.length - VISIBLE_TASKS} more
          </div>
        </SidebarMenuItem>
      )}

      {editTodo !== undefined && (
        <TaskEditModal
          port={port}
          projectId={projectId}
          todo={editTodo}
          allTodos={todos}
          allLabels={extractAllLabels(todos)}
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
