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
import { CountBadge } from '@/components/ui/count-badge';
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
        'flex flex-col min-h-0 rounded-md transition-colors',
        dragOver ? 'bg-mf-selection ring-1 ring-inset ring-primary' : 'bg-mf-content2',
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Column header — chip sits adjacent to the label at a 7px gap, not
          right-aligned (design: 12-todos.jsx:617, finding 9.15). */}
      <div className="flex shrink-0 items-center gap-[7px] px-3.5 pb-4 pt-2.5">
        <span className="text-caption font-medium text-muted-foreground">{STATUS_LABEL[status]}</span>
        <CountBadge count={todos.length} variant="info" />
      </div>

      {/* Cards — 9px gap per design (12-todos.jsx:621, finding 9.14).
          min-h keeps columns from collapsing to a single card's height when
          sparsely populated (~3 cards' worth, so the board never looks like
          it's missing content next to a fuller sibling column). */}
      <div className="flex min-h-[320px] flex-1 flex-col gap-[9px] overflow-y-auto px-5 pb-5">
        {todos.map((todo) => (
          <TaskCard key={todo.id} todo={todo} onEdit={onEdit} onDelete={onDelete} onStartSession={onStartSession} />
        ))}
        {todos.length === 0 && (
          <div
            data-testid={`tasks-column-${status}-empty`}
            className="flex-1 flex items-center justify-center text-caption text-muted-foreground py-6 border border-dashed border-border rounded-md min-h-[72px]"
          >
            {dragOver ? 'Drop here' : filtersActive ? 'No matches' : 'Nothing here'}
          </div>
        )}
      </div>
    </div>
  );
}
