import React from 'react';
import { ArrowLeft, ArrowRight, Play, Edit, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Todo, TodoStatus } from '../../lib/api/todos-api';

const TYPE_COLORS: Record<string, string> = {
  bug: 'bg-red-500/15 text-red-400',
  feature: 'bg-blue-500/15 text-blue-400',
  enhancement: 'bg-purple-500/15 text-purple-400',
  documentation: 'bg-gray-500/15 text-mf-text-secondary',
  question: 'bg-yellow-500/15 text-yellow-400',
  wont_fix: 'bg-gray-500/10 text-mf-text-secondary',
  duplicate: 'bg-orange-500/15 text-orange-400',
  invalid: 'bg-gray-500/10 text-mf-text-secondary',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-mf-text-secondary',
};

const COLUMN_ORDER: TodoStatus[] = ['open', 'in_progress', 'done'];

interface Props {
  todo: Todo;
  onMove: (id: string, status: TodoStatus) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (id: string) => void;
  onStartSession: (todo: Todo) => void;
}

export function TodoCard({ todo, onMove, onEdit, onDelete, onStartSession }: Props): React.ReactElement {
  const colIdx = COLUMN_ORDER.indexOf(todo.status);
  const canMoveLeft = colIdx > 0;
  const canMoveRight = colIdx < COLUMN_ORDER.length - 1;

  return (
    <div
      data-testid="todo-card"
      draggable
      onDragStart={(e) => e.dataTransfer.setData('todo-id', todo.id)}
      onClick={() => onEdit(todo)}
      className="bg-mf-app-bg rounded-mf-input p-3 space-y-2 border border-mf-border group cursor-pointer"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            'text-mf-status font-medium px-1.5 py-0.5 rounded capitalize',
            TYPE_COLORS[todo.type] ?? 'bg-mf-hover text-mf-text-secondary',
          )}
        >
          {todo.type.replace('_', ' ')}
        </span>
        <span className={cn('text-mf-status font-medium capitalize', PRIORITY_COLORS[todo.priority] ?? '')}>
          {todo.priority}
        </span>
      </div>

      {/* Title */}
      <p className="text-mf-small text-mf-text-primary leading-snug">{todo.title}</p>

      {/* Labels */}
      {todo.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {todo.labels.map((l) => (
            <span key={l} className="text-mf-status bg-mf-hover px-1.5 py-0.5 rounded text-mf-text-secondary">
              {l}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-1">
          {canMoveLeft && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMove(todo.id, COLUMN_ORDER[colIdx - 1]!);
              }}
              className="p-1 rounded text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors"
              title="Move left"
              aria-label="Move to previous column"
            >
              <ArrowLeft size={12} />
            </button>
          )}
          {canMoveRight && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMove(todo.id, COLUMN_ORDER[colIdx + 1]!);
              }}
              className="p-1 rounded text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors"
              title="Move right"
              aria-label="Move to next column"
            >
              <ArrowRight size={12} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {todo.status === 'in_progress' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStartSession(todo);
              }}
              className="flex items-center gap-1 px-2 py-1 rounded text-mf-small text-mf-accent hover:bg-mf-accent/10 transition-colors"
              title="Start in session"
              aria-label="Start in new session"
            >
              <Play size={11} />
              Session
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit(todo);
            }}
            className="p-1 rounded text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors opacity-0 group-hover:opacity-100"
            title="Edit"
            aria-label="Edit task"
          >
            <Edit size={12} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(todo.id);
            }}
            className="p-1 rounded text-mf-text-secondary hover:text-mf-destructive hover:bg-mf-hover transition-colors opacity-0 group-hover:opacity-100"
            title="Delete"
            aria-label="Delete task"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
