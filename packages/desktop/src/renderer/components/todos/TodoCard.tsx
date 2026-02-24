import React from 'react';
import { Play, Edit, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Todo } from '../../lib/api/todos-api';

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

const PRIORITY_PILL: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-400',
  high: 'bg-orange-500/15 text-orange-400',
  medium: 'bg-yellow-500/15 text-yellow-400',
  low: 'bg-gray-500/10 text-mf-text-secondary',
};

interface Props {
  todo: Todo;
  onEdit: (todo: Todo) => void;
  onDelete: (id: string) => void;
  onStartSession: (todo: Todo) => void;
}

export function TodoCard({ todo, onEdit, onDelete, onStartSession }: Props): React.ReactElement {
  return (
    <div
      data-testid="todo-card"
      draggable
      onDragStart={(e) => e.dataTransfer.setData('todo-id', todo.id)}
      onClick={() => onEdit(todo)}
      className="bg-mf-app-bg rounded-mf-input p-3 space-y-1.5 border border-mf-border group cursor-pointer"
    >
      {/* Row 1: type badge + #number + title */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className={cn(
            'shrink-0 text-mf-status font-medium px-1.5 py-0.5 rounded capitalize',
            TYPE_COLORS[todo.type] ?? 'bg-mf-hover text-mf-text-secondary',
          )}
        >
          {todo.type.replace('_', ' ')}
        </span>
        <span className="shrink-0 font-mono text-mf-status text-mf-text-secondary">#{todo.number}</span>
        <span className="text-mf-small text-mf-text-primary leading-snug truncate">{todo.title}</span>
      </div>

      {/* Row 2: priority pill */}
      <div>
        <span
          className={cn(
            'inline-block text-mf-status font-medium px-1.5 py-0.5 rounded capitalize',
            PRIORITY_PILL[todo.priority] ?? 'bg-gray-500/10 text-mf-text-secondary',
          )}
        >
          {todo.priority}
        </span>
      </div>

      {/* Row 3: labels + actions on hover */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 min-w-0">
          {todo.labels.map((l) => (
            <span key={l} className="text-mf-status bg-mf-hover px-1.5 py-0.5 rounded text-mf-text-secondary">
              {l}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {(todo.status === 'open' || todo.status === 'in_progress') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStartSession(todo);
              }}
              className="p-1 rounded text-mf-accent hover:bg-mf-accent/10 transition-colors"
              title="Start session"
              aria-label="Start in new session"
            >
              <Play size={12} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit(todo);
            }}
            className="p-1 rounded text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors"
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
            className="p-1 rounded text-mf-text-secondary hover:text-mf-destructive hover:bg-mf-hover transition-colors"
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
