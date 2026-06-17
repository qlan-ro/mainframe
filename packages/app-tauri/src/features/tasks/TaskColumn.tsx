/**
 * TaskColumn — a single kanban column for the Tasks board view.
 *
 * Renders a list of TaskCards for one status bucket. Accepts drag-over /
 * drop events; reads the dragged todo.number from dataTransfer and calls
 * onDrop(number, status) → useTodosStore.move.
 *
 * data-testid="tasks-column-${status}".
 */
import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { TaskCard } from './TaskCard';
import type { Todo, TodoStatus } from '@/lib/api/todos';

const STATUS_LABEL: Record<TodoStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  done: 'Done',
};

interface Props {
  status: TodoStatus;
  todos: Todo[];
  filtersActive?: boolean;
  onDrop: (number: number, status: TodoStatus) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (id: string) => void;
  onStartSession: (todo: Todo) => void;
}

export function TaskColumn({
  status,
  todos,
  filtersActive,
  onDrop,
  onEdit,
  onDelete,
  onStartSession,
}: Props): React.ReactElement {
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData('todo-number');
    const number = parseInt(raw, 10);
    if (!isNaN(number)) onDrop(number, status);
  };

  return (
    <div
      data-testid={`tasks-column-${status}`}
      className={cn(
        'flex flex-col min-h-0 transition-colors',
        dragOver ? 'bg-primary/5' : 'bg-mf-content2',
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Column header */}
      <div className="flex shrink-0 items-center gap-2 px-3.5 pb-4 pt-2.5">
        <span className="text-caption font-bold uppercase tracking-wide text-muted-foreground">
          {STATUS_LABEL[status]}
        </span>
        <span className="ml-auto rounded-md bg-mf-chip px-1.5 py-px font-mono text-micro text-mf-text-3">
          {todos.length}
        </span>
      </div>

      {/* Cards */}
      <div className="mf-thin-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-5 pb-5">
        {todos.map((todo) => (
          <TaskCard key={todo.id} todo={todo} onEdit={onEdit} onDelete={onDelete} onStartSession={onStartSession} />
        ))}
        {todos.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-caption text-muted-foreground py-6 border border-dashed border-border rounded-md min-h-[72px]">
            {dragOver ? 'Drop here' : filtersActive ? 'No matches' : 'Nothing here'}
          </div>
        )}
      </div>
    </div>
  );
}
