import { Check, CircleDashed } from 'lucide-react';
import type { TodoItem } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { ContextSection } from './ContextSection';

/** Context-tab Tasks group: completion bar inline in the section header, then the per-chat TodoWrite rows. */
export function TasksSection({ todos }: { todos: readonly TodoItem[] }): React.ReactElement {
  const total = todos.length;
  const completed = todos.filter((t) => t.status === 'completed').length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div data-testid="context-tasks-section">
      <ContextSection
        icon={CircleDashed}
        title="Tasks"
        defaultOpen
        trailing={
          <>
            <span className="inline-block h-[4px] min-w-0 flex-1 overflow-hidden rounded-[3px] bg-mf-chip">
              <span
                data-testid="context-tasks-progress-fill"
                className="block h-full rounded-[3px] bg-mf-success transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="shrink-0 font-mono text-caption tabular-nums text-muted-foreground">
              {completed}/{total}
            </span>
          </>
        }
      >
        <div>
          {todos.map((todo) => {
            const done = todo.status === 'completed';
            const label = todo.status === 'in_progress' ? todo.activeForm : todo.content;
            return (
              <div
                key={todo.content}
                data-testid={`context-task-row-${todo.content}`}
                className="flex items-center gap-[7px] px-[14px] py-[4px] text-label tracking-tight"
              >
                <span
                  className={cn(
                    'flex size-[12px] shrink-0 items-center justify-center rounded-[4px] border-[1.5px]',
                    done ? 'border-mf-success bg-mf-success' : 'border-mf-text-3',
                  )}
                >
                  {done && <Check className="size-[8px] text-white" strokeWidth={3} />}
                </span>
                <span
                  className={cn('flex-1 truncate', done ? 'text-muted-foreground line-through' : 'text-foreground')}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </ContextSection>
    </div>
  );
}
