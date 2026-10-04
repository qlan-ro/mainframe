/**
 * TaskSidebarRow — one 36px task in the sidebar Tasks list: the status dot
 * (click cycles open → in progress → done → open, as the board's list row
 * does), `#n` in mono, the title fading only when it overflows, and hover
 * Start / Edit. The row itself opens the edit modal.
 *
 * data-testid: tasks-sidebar-row-<n> / -cycle-<n> / -start-<n> / -edit-<n>.
 */
import { Check, Pencil, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FadeLabel } from '@/components/ui/fade-label';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import type { Todo, TodoStatus } from '@/lib/api/todos';

/** open → in progress → done → open. */
export function nextTodoStatus(status: TodoStatus): TodoStatus {
  return status === 'open' ? 'in_progress' : status === 'in_progress' ? 'done' : 'open';
}

function StatusGlyph({ status }: { status: TodoStatus }) {
  if (status === 'done') {
    return (
      <span className="flex size-3.5 items-center justify-center rounded-full bg-success text-primary-foreground">
        <Check size={9} strokeWidth={3} aria-hidden />
      </span>
    );
  }
  if (status === 'in_progress') {
    return (
      <span className="flex size-3.5 items-center justify-center rounded-full border-2 border-primary">
        <span className="size-1 rounded-full bg-primary" aria-hidden />
      </span>
    );
  }
  return <span className="size-3.5 rounded-full border-[1.5px] border-muted-foreground" />;
}

interface TaskSidebarRowProps {
  todo: Todo;
  onCycle: (todo: Todo) => void;
  onEdit: (todo: Todo) => void;
  onStart: (todo: Todo) => void;
}

export function TaskSidebarRow({ todo, onCycle, onEdit, onStart }: TaskSidebarRowProps) {
  const done = todo.status === 'done';
  return (
    <div
      data-testid={`tasks-sidebar-row-${todo.number}`}
      role="button"
      tabIndex={0}
      onClick={() => onEdit(todo)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onEdit(todo);
        }
      }}
      className="group flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-sidebar-accent"
    >
      <Hint label={`Status: ${todo.status.replace('_', ' ')} — click to cycle`}>
        <button
          type="button"
          data-testid={`tasks-sidebar-cycle-${todo.number}`}
          aria-label={`Status: ${todo.status}. Click to cycle.`}
          onClick={(event) => {
            event.stopPropagation();
            onCycle(todo);
          }}
          className="flex size-5 shrink-0 items-center justify-center rounded-full"
        >
          <StatusGlyph status={todo.status} />
        </button>
      </Hint>
      <span className="w-8 shrink-0 font-mono text-xs text-primary tabular-nums">#{todo.number}</span>
      <FadeLabel className={cn('flex-1', done ? 'text-muted-foreground line-through' : 'text-foreground')}>
        {todo.title}
      </FadeLabel>
      {/* Hidden, not transparent: an invisible cluster would still take the title's width. */}
      <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex focus-within:flex">
        {!done && (
          <Hint label={todo.status === 'in_progress' ? 'Resume session' : 'Start session'}>
            <Button
              variant="ghost"
              size="icon-xs"
              data-testid={`tasks-sidebar-start-${todo.number}`}
              aria-label="Start session"
              className="text-primary"
              onClick={(event) => {
                event.stopPropagation();
                onStart(todo);
              }}
            >
              <Play />
            </Button>
          </Hint>
        )}
        <Hint label="Edit">
          <Button
            variant="ghost"
            size="icon-xs"
            data-testid={`tasks-sidebar-edit-${todo.number}`}
            aria-label="Edit task"
            className="text-muted-foreground"
            onClick={(event) => {
              event.stopPropagation();
              onEdit(todo);
            }}
          >
            <Pencil />
          </Button>
        </Hint>
      </span>
    </div>
  );
}
