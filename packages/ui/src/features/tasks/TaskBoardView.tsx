/**
 * TaskBoardView — 3-column kanban board (open / in_progress / done).
 *
 * Receives todos and handlers from TasksBoard; no data loading here. A drop
 * moves the todo using ITS OWN project (multi-project Tasks — the board no
 * longer has a single `projectId` of its own to fall back on).
 */
import React from 'react';
import type { Project } from '@qlan-ro/mainframe-types';
import type { Todo, TodoStatus } from '@/lib/api/todos';
import { TaskColumn } from './TaskColumn';

const COLUMNS: TodoStatus[] = ['open', 'in_progress', 'done'];

interface Props {
  port: number;
  todos: Todo[];
  filtersActive?: boolean;
  /** Only needed when `multi` is true — resolves each card's project avatar. */
  projects?: Project[];
  /** More than one project in scope — shows each card's project avatar. */
  multi?: boolean;
  onEdit: (todo: Todo) => void;
  onDelete: (id: string) => void;
  onStartSession: (todo: Todo) => void;
  onMove: (port: number, id: string, status: TodoStatus, projectId: string) => void;
}

export function TaskBoardView({
  port,
  todos,
  filtersActive,
  projects = [],
  multi = false,
  onEdit,
  onDelete,
  onStartSession,
  onMove,
}: Props): React.ReactElement {
  function handleDrop(number: number, status: TodoStatus) {
    const todo = todos.find((t) => t.number === number);
    if (!todo || todo.status === status) return;
    void onMove(port, todo.id, status, todo.project_id);
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-3 gap-px overflow-hidden bg-border">
      {COLUMNS.map((status) => (
        <TaskColumn
          key={status}
          status={status}
          todos={todos.filter((t) => t.status === status)}
          filtersActive={filtersActive}
          projects={projects}
          multi={multi}
          onDrop={handleDrop}
          onEdit={onEdit}
          onDelete={onDelete}
          onStartSession={onStartSession}
        />
      ))}
    </div>
  );
}
