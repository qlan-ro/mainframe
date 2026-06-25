/**
 * TaskListRow — compact list-view row for a single Todo.
 *
 * Collapsed: priority stripe · status dot (cycle button) · #number · title · priority pill.
 * Expanded: body · milestone · dependencies · timestamps · Start/Resume/Edit buttons.
 *
 * Port of packages/app-electron/src/renderer/components/todos/TodoCard.tsx (list
 * variant), rebuilt on app-tauri shadcn/ui + warm-chrome theme tokens.
 */
import React from 'react';
import { ChevronDown, ChevronRight, Play, Edit, Trash2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { Todo } from '@/lib/api/todos';
import { priorityTint, priorityDotClass, typeTint } from './task-palettes';

interface Props {
  todo: Todo;
  selected: boolean;
  expanded: boolean;
  onToggle: (number: number) => void;
  onEdit: (todo: Todo) => void;
  onStartSession: (todo: Todo) => void;
  onCycle: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

/** Leading full-height priority color stripe (~3px wide). */
function PriorityStripe({ todo }: { todo: Todo }): React.ReactElement {
  const stripeClass = cn(
    'w-[3px] self-stretch shrink-0',
    todo.status === 'done'
      ? 'bg-muted-foreground/30'
      : todo.status === 'in_progress'
        ? 'bg-primary'
        : (() => {
            switch (todo.priority) {
              case 'critical':
                return 'bg-red-500';
              case 'high':
                return 'bg-orange-500';
              case 'medium':
                return 'bg-yellow-500';
              default:
                return 'bg-muted-foreground/40';
            }
          })(),
  );
  return <span className={stripeClass} aria-hidden />;
}

/**
 * StatusDot — interactive cycle button with three distinct visual states:
 *  open       = empty ring (border only, no fill), border-primary on hover
 *  in_progress = primary-colored ring + inner pulsing dot
 *  done       = filled mf-success circle with a white checkmark
 */
function StatusDot({ todo, onCycle }: { todo: Todo; onCycle: (id: string) => void }): React.ReactElement {
  const { status, id, number } = todo;

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    onCycle(id);
  }

  return (
    <button
      type="button"
      data-testid={`tasks-list-row-cycle-${number}`}
      aria-label={`Status: ${status}. Click to cycle.`}
      onClick={handleClick}
      className={cn(
        'shrink-0 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-full',
        status === 'done'
          ? 'w-4 h-4 bg-mf-success'
          : status === 'in_progress'
            ? 'w-[15px] h-[15px] rounded-full border-2 border-primary'
            : 'w-3.5 h-3.5 rounded-full border-[1.6px] border-mf-text-4 hover:border-primary',
      )}
    >
      {status === 'done' && <Check size={9} className="text-white" strokeWidth={3} />}
      {status === 'in_progress' && (
        <span data-status-pulse className="w-[5px] h-[5px] rounded-full bg-primary animate-pulse" aria-hidden />
      )}
    </button>
  );
}

/** Priority pill with a leading colored dot. */
function PriorityPill({ todo }: { todo: Todo }): React.ReactElement {
  return (
    <span
      className={cn(
        'shrink-0 inline-flex items-center gap-1 text-caption font-medium px-1.5 py-0.5 rounded capitalize leading-4',
        priorityTint(todo.priority),
      )}
    >
      <span
        data-testid={`tasks-priority-dot-${todo.number}`}
        className={cn('w-1.5 h-1.5 rounded-full shrink-0 inline-block', priorityDotClass(todo.priority))}
        aria-hidden
      />
      {todo.priority}
    </span>
  );
}

export function TaskListRow({
  todo,
  selected,
  expanded,
  onToggle,
  onEdit,
  onStartSession,
  onCycle,
  onDelete,
}: Props): React.ReactElement {
  const canStart = todo.status === 'open' || todo.status === 'in_progress';
  const isDone = todo.status === 'done';

  return (
    <div
      data-testid={`tasks-list-row-${todo.number}`}
      className={cn('border-b border-border last:border-b-0', selected && 'bg-accent')}
    >
      {/* Collapsed header row */}
      <div
        className={cn(
          'flex items-center gap-2 py-2 pr-3 hover:bg-accent transition-colors group',
          !selected && 'hover:bg-accent/50',
        )}
      >
        {/* Priority stripe */}
        <PriorityStripe todo={todo} />

        {/* Expand/collapse chevron */}
        <button
          data-testid={`tasks-list-row-expand-${todo.number}`}
          onClick={() => onToggle(todo.number)}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {/* Status dot — interactive cycle button */}
        <StatusDot todo={todo} onCycle={onCycle} />

        {/* Number */}
        <span className="shrink-0 font-mono text-caption font-medium text-primary w-10 text-right">#{todo.number}</span>

        {/* Title */}
        <span
          className={cn(
            'flex-1 min-w-0 text-body truncate',
            isDone ? 'line-through text-muted-foreground' : 'text-foreground',
          )}
        >
          {todo.title}
        </span>

        {/* Type badge */}
        <span
          data-testid={`tasks-list-row-type-${todo.number}`}
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-caption font-medium capitalize leading-4',
            typeTint(todo.type),
          )}
        >
          {todo.type.replace('_', ' ')}
        </span>

        {/* Priority pill with leading dot */}
        <PriorityPill todo={todo} />

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
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                data-testid={`tasks-list-row-delete-${todo.number}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(todo.id);
                }}
                className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
                aria-label="Delete task"
              >
                <Trash2 size={13} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="px-10 pb-3 space-y-2 text-body text-muted-foreground bg-accent/50">
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
                <span key={l} className="text-caption bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                  {l}
                </span>
              ))}
            </div>
          )}

          {/* Primary CTA row */}
          <div className="flex items-center gap-2 pt-1">
            {!isDone && (
              <button
                data-testid={`tasks-list-row-start-cta-${todo.number}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onStartSession(todo);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-caption font-semibold hover:opacity-90 transition-opacity"
              >
                <Play size={12} />
                {todo.status === 'in_progress' ? 'Resume session' : 'Start session'}
              </button>
            )}
            <button
              data-testid={`tasks-list-row-edit-cta-${todo.number}`}
              onClick={(e) => {
                e.stopPropagation();
                onEdit(todo);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-card text-muted-foreground text-caption font-medium hover:text-foreground transition-colors"
            >
              <Edit size={12} />
              Edit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
