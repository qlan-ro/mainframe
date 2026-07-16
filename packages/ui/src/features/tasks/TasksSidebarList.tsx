/**
 * TasksSidebarList — task rows for the left-sidebar Tasks section.
 *
 * SINGLE loader owner for the sidebar section: installs the project-scoped
 * useTodosStore.load() effect (loads on mount + on projectId change).
 * TasksModalHost separately reloads on the full-modal's open/quick-add rising
 * edge — the two loaders don't race, both go through the store's `_loadSeq`
 * staleness guard.
 *
 * Filters to active tasks (status !== 'done') and shows at most
 * VISIBLE_TASKS rows — no internal scroll region (macOS sidebars keep one
 * scroll container; long collections link out instead). Overflow ends the
 * section with a "View all N tasks" row that opens the full Tasks view.
 * Click on a row → opens TaskEditModal via local state (section-local).
 *
 * Row treatment mirrors SessionRow (mx-2 rounded-md hover:bg-accent), not the
 * old bordered-list drawer rows, so it reads as a sibling of the Sessions list.
 *
 * data-testid="tasks-sidebar-row-${number}".
 */
import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useTodosStore } from './use-todos-store';
import { useTasksModal } from './use-tasks-modal';
import { TaskEditModal } from './TaskEditModal';
import type { Todo } from '@/lib/api/todos';
import { extractAllLabels } from './todos-filters';
import { SIDEBAR_INDENT_STEP_PX } from '@/layout/sidebar-indent';

/** Level 1 — same depth as "+ New task" (no task sub-grouping exists yet). */
const TASK_ROW_INDENT_PX = SIDEBAR_INDENT_STEP_PX;

/** Sidebar preview size; the full backlog lives in the Tasks modal. */
const VISIBLE_TASKS = 5;

interface Props {
  port: number;
  projectId: string;
  onStartSession: (todo: Todo) => void; // required; caller passes useStartTodoSession result
}

export function TasksSidebarList({ port, projectId, onStartSession }: Props): React.ReactElement {
  const { load, todos } = useTodosStore();
  const openModal = useTasksModal((s) => s.openModal);
  const [editTodo, setEditTodo] = useState<Todo | null | undefined>(undefined);

  // SINGLE loader owner: this component is always mounted when projectId is set.
  useEffect(() => {
    void load(port, projectId);
  }, [port, projectId, load]);

  const active = todos.filter((t) => t.status !== 'done');
  const shown = active.slice(0, VISIBLE_TASKS);
  const allLabels = extractAllLabels(todos);

  return (
    <>
      <div className="flex flex-col">
        {active.length === 0 ? (
          <div data-testid="tasks-sidebar-empty" className="px-3 py-2 text-caption text-muted-foreground">
            No active tasks.
          </div>
        ) : (
          shown.map((todo) => (
            <button
              key={todo.id}
              type="button"
              data-testid={`tasks-sidebar-row-${todo.number}`}
              onClick={() => setEditTodo(todo)}
              style={{ marginLeft: TASK_ROW_INDENT_PX }}
              className={cn(
                'mr-2 flex h-[28px] items-center gap-2 rounded-md px-[12px] text-left',
                'transition-colors hover:bg-accent',
              )}
            >
              <span className="shrink-0 text-body text-primary">#{todo.number}</span>
              <span className="flex-1 min-w-0 text-body text-foreground truncate">{todo.title}</span>
            </button>
          ))
        )}
        {active.length > VISIBLE_TASKS && (
          <button
            data-testid="tasks-sidebar-view-all"
            type="button"
            onClick={openModal}
            style={{ marginLeft: TASK_ROW_INDENT_PX }}
            className="mr-2 flex h-[24px] items-center px-[12px] text-left text-caption font-semibold tracking-normal text-primary transition-colors hover:underline"
          >
            View all {active.length} tasks
          </button>
        )}
      </div>

      {/* Section-local edit modal */}
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
