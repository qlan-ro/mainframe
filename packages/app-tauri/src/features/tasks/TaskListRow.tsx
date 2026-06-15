/**
 * TaskListRow — compact list-view row for a single Todo.
 *
 * Collapsed: status dot · #number · title · priority pill.
 * Expanded: body · milestone · dependencies · timestamps · Start/Edit buttons.
 *
 * Port of packages/desktop/src/renderer/components/todos/TodoCard.tsx (list
 * variant), rebuilt on app-tauri shadcn/ui + warm-chrome theme tokens.
 */
import React from 'react';
import { ChevronDown, ChevronRight, Play, Edit } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { Todo } from '@/lib/api/todos';
import { statusDotColor, priorityTint } from './task-palettes';

interface Props {
  todo: Todo;
  expanded: boolean;
  onToggle: (number: number) => void;
  onEdit: (todo: Todo) => void;
  onStartSession: (todo: Todo) => void;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

export function TaskListRow({ todo, expanded, onToggle, onEdit, onStartSession }: Props): React.ReactElement {
  const canStart = todo.status === 'open' || todo.status === 'in_progress';

  return (
    <div data-testid={`tasks-list-row-${todo.number}`} className="border-b border-border last:border-b-0">
      {/* Collapsed header row */}
      <div className="flex items-center gap-2 px-3 py-2 hover:bg-accent transition-colors group">
        {/* Expand/collapse chevron */}
        <button
          data-testid={`tasks-list-row-expand-${todo.number}`}
          onClick={() => onToggle(todo.number)}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {/* Status dot */}
        <span className={cn('shrink-0 w-2 h-2 rounded-full', statusDotColor(todo.status))} aria-label={todo.status} />

        {/* Number */}
        <span className="shrink-0 font-mono text-caption font-medium text-primary w-10 text-right">#{todo.number}</span>

        {/* Title */}
        <span className="flex-1 min-w-0 text-body text-foreground truncate">{todo.title}</span>

        {/* Priority pill */}
        <span
          className={cn(
            'shrink-0 text-caption font-medium px-1.5 py-0.5 rounded capitalize leading-4',
            priorityTint(todo.priority),
          )}
        >
          {todo.priority}
        </span>

        {/* Hover actions */}
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
          {canStart && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  data-testid={`tasks-list-row-start-${todo.number}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartSession(todo);
                  }}
                  className="p-1.5 rounded text-primary hover:bg-accent transition-colors"
                  aria-label="Start in new session"
                >
                  <Play size={13} />
                </button>
              </TooltipTrigger>
              <TooltipContent>Start session</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                data-testid={`tasks-list-row-edit-${todo.number}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(todo);
                }}
                className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label="Edit task"
              >
                <Edit size={13} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="px-10 pb-3 space-y-2 text-body text-muted-foreground bg-accent">
          {todo.body && <p className="whitespace-pre-wrap text-foreground text-caption leading-relaxed">{todo.body}</p>}

          <div className="flex flex-wrap gap-4 text-caption">
            {todo.milestone && (
              <span>
                <span className="font-medium text-foreground">Milestone:</span> {todo.milestone}
              </span>
            )}
            {todo.dependencies.length > 0 && (
              <span>
                <span className="font-medium text-foreground">Depends on:</span>{' '}
                {todo.dependencies.map((n) => `#${n}`).join(', ')}
              </span>
            )}
            {todo.assignees.length > 0 && (
              <span>
                <span className="font-medium text-foreground">Assignees:</span> {todo.assignees.join(', ')}
              </span>
            )}
          </div>

          <div className="flex gap-4 text-caption text-muted-foreground">
            <span>Created {formatDate(todo.created_at)}</span>
            <span>Updated {formatDate(todo.updated_at)}</span>
          </div>

          {/* Labels row */}
          {todo.labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {todo.labels.map((l) => (
                <span key={l} className="text-caption bg-[var(--mf-chip)] px-1.5 py-0.5 rounded text-muted-foreground">
                  {l}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
