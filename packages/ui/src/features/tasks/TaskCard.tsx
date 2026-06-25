/**
 * TaskCard — kanban board card for a single Todo.
 *
 * Draggable: writes todo.number to dataTransfer as 'todo-number'.
 * Hover actions: Start session (open/in_progress only), Edit, Delete.
 * Memoized with React.memo.
 *
 * Port of packages/app-electron/src/renderer/components/todos/TodoCard.tsx,
 * rebuilt on app-tauri shadcn/ui + warm-chrome theme tokens.
 */
import React from 'react';
import { Play, Edit, Trash2, Paperclip, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { Todo } from '@/lib/api/todos';
import { typeTint, priorityTint, priorityDotClass } from './task-palettes';

/** Returns a short human-readable "ago" string for an ISO date string. */
function relativeTime(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const days = Math.round(diffMs / 86_400_000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 28) return `${Math.round(days / 7)}w ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

interface Props {
  todo: Todo;
  attachmentCount?: number;
  onEdit: (todo: Todo) => void;
  onDelete: (id: string) => void;
  onStartSession: (todo: Todo) => void;
}

export const TaskCard = React.memo(function TaskCard({
  todo,
  attachmentCount,
  onEdit,
  onDelete,
  onStartSession,
}: Props): React.ReactElement {
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('todo-number', String(todo.number));
  };

  return (
    <div
      data-testid={`tasks-card-${todo.number}`}
      draggable
      onDragStart={handleDragStart}
      onClick={() => onEdit(todo)}
      className={cn(
        'group cursor-pointer space-y-1.5 rounded-md border-[0.5px] border-border bg-background px-[11px] py-[10px]',
        'transition-colors hover:border-border/80',
      )}
    >
      {/* Row 1: #number + title + type badge */}
      <div className="flex items-start gap-1.5 min-w-0">
        <span className="shrink-0 font-mono text-caption font-medium text-primary leading-5">#{todo.number}</span>
        <span className="flex-1 min-w-0">
          <span
            className={cn(
              'text-body font-semibold leading-snug line-clamp-2',
              todo.status === 'done' ? 'line-through text-muted-foreground' : 'text-foreground',
            )}
          >
            {todo.title}
          </span>
        </span>
        <span
          className={cn(
            'shrink-0 text-caption font-medium px-1.5 py-0.5 rounded capitalize leading-4',
            typeTint(todo.type),
          )}
        >
          {todo.type.replace('_', ' ')}
        </span>
      </div>

      {/* Dependencies line */}
      {todo.dependencies.length > 0 && (
        <div className="text-caption text-muted-foreground">
          Depends on {todo.dependencies.map((n) => `#${n}`).join(', ')}
        </div>
      )}

      {/* Row 2: priority pill + right-aligned updated timestamp */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1 text-caption font-medium px-1.5 py-0.5 rounded capitalize leading-4',
            priorityTint(todo.priority),
          )}
        >
          <span
            className={cn('w-1.5 h-1.5 rounded-full shrink-0 inline-block', priorityDotClass(todo.priority))}
            aria-hidden
          />
          {todo.priority}
        </span>
        <span className="flex-1" />
        <span
          title={`Updated ${new Date(todo.updated_at).toLocaleDateString()}`}
          className="inline-flex items-center gap-1 text-caption text-muted-foreground shrink-0 whitespace-nowrap"
        >
          <Clock size={10} aria-hidden />
          {relativeTime(todo.updated_at)}
        </span>
      </div>

      {/* Row 3: labels + attachments + hover actions */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 min-w-0">
          {todo.labels.map((l) => (
            <span key={l} className="text-caption bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
              {l}
            </span>
          ))}
          {attachmentCount != null && attachmentCount > 0 && (
            <span className="flex items-center gap-0.5 text-caption text-muted-foreground">
              <Paperclip size={10} />
              {attachmentCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {(todo.status === 'open' || todo.status === 'in_progress') && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  data-testid={`tasks-card-start-${todo.number}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartSession(todo);
                  }}
                  className="p-1.5 rounded text-primary hover:bg-accent transition-colors"
                  aria-label="Start in new session"
                >
                  <Play size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent>Start session</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                data-testid={`tasks-card-edit-${todo.number}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(todo);
                }}
                className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label="Edit task"
              >
                <Edit size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                data-testid={`tasks-card-delete-${todo.number}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(todo.id);
                }}
                className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
                aria-label="Delete task"
              >
                <Trash2 size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
});
