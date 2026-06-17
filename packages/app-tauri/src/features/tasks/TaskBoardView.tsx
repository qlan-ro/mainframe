/**
 * TaskBoardView — 3-column kanban board (open / in_progress / done).
 *
 * Receives todos and handlers from TasksBoard; no data loading here.
 * Drop events call onMove → useTodosStore.move.
 */
import React from 'react';
import type { Todo, TodoStatus } from '@/lib/api/todos';
import { TaskColumn } from './TaskColumn';

const COLUMNS: TodoStatus[] = ['open', 'in_progress', 'done'];

interface Props {
  port: number;
  projectId: string;
  todos: Todo[];
  filtersActive?: boolean;
  onEdit: (todo: Todo) => void;
  onDelete: (id: string) => void;
  onStartSession: (todo: Todo) => void;
  onMove: (port: number, id: string, status: TodoStatus, projectId: string) => void;
}

export function TaskBoardView({
  port,
  projectId,
  todos,
  filtersActive,
  onEdit,
  onDelete,
  onStartSession,
  onMove,
}: Props): React.ReactElement {
  function handleDrop(number: number, status: TodoStatus) {
    const todo = todos.find((t) => t.number === number);
    if (!todo || todo.status === status) return;
    void onMove(port, todo.id, status, projectId);
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-3 gap-px overflow-hidden bg-border">
      {COLUMNS.map((status) => (
        <TaskColumn
          key={status}
          status={status}
          todos={todos.filter((t) => t.status === status)}
          filtersActive={filtersActive}
          onDrop={handleDrop}
          onEdit={onEdit}
          onDelete={onDelete}
          onStartSession={onStartSession}
        />
      ))}
    </div>
  );
}
