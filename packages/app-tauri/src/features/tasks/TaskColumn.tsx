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
  onDrop: (number: number, status: TodoStatus) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (id: string) => void;
  onStartSession: (todo: Todo) => void;
}

export function TaskColumn({ status, todos, onDrop, onEdit, onDelete, onStartSession }: Props): React.ReactElement {
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
        'flex flex-col gap-2 min-h-0 flex-1 rounded-lg p-2 transition-colors',
        dragOver ? 'bg-accent/60 ring-1 ring-border' : 'bg-muted/40',
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-1 py-0.5 shrink-0">
        <span className="text-xs font-semibold text-foreground">{STATUS_LABEL[status]}</span>
        <span className="ml-auto text-xs font-medium text-muted-foreground bg-background rounded-full px-1.5 py-0.5">
          {todos.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2 overflow-y-auto min-h-0 flex-1 mf-thin-scrollbar">
        {todos.map((todo) => (
          <TaskCard key={todo.id} todo={todo} onEdit={onEdit} onDelete={onDelete} onStartSession={onStartSession} />
        ))}
        {todos.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground py-6">No tasks</div>
        )}
      </div>
    </div>
  );
}
