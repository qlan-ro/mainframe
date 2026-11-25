/**
 * TasksSection — the project's active tasks, newest first. It owns the
 * project-scoped todos load; the store's own sequence guard makes the board's
 * loader harmless rather than racy.
 *
 * Reminder-style entry: the first row IS the create input — type a title,
 * Enter adds the task and keeps focus for the next one (`useQuickAddTodo`,
 * shared with the sidebar Tasks list). Rows open the ONE task edit modal
 * (`useTasksModal.openEdit`, mounted in `TasksModalHost`). Without an active
 * project there is nothing to scope to, so the card says so instead of
 * rendering an empty list that reads as "no tasks".
 */
import { useEffect, useState } from 'react';
import { Paperclip, Plus, X } from 'lucide-react';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useTodosStore, selectProjectTodos } from '@/features/tasks/use-todos-store';
import { useTasksModal } from '@/features/tasks/use-tasks-modal';
import { useQuickAddTodo } from '@/features/tasks/use-quick-add-todo';
import { newestFirst } from '@/features/tasks/todos-filters';
import { PanelEmpty, PanelRow, PanelSection, RowIcon, ShowAllRow } from './PanelSection';

/** The newest tasks; the rest wait behind Show all. */
const TASKS_SHOWN = 5;

function AttachmentCountChip({ count, onClear }: { count: number; onClear: () => void }) {
  // Indented to the text column (16px lane + 8px gap), sized like the row
  // badges elsewhere in the panel.
  return (
    <span
      data-testid="session-panel-tasks-attachments"
      className="ml-6 inline-flex h-[18px] w-fit items-center gap-1 rounded-full bg-muted pr-0.5 pl-1.5 text-xs text-muted-foreground"
    >
      <Paperclip size={10} aria-hidden />
      {count} attachment{count === 1 ? '' : 's'}
      <button
        type="button"
        data-testid="session-panel-tasks-attachments-clear"
        aria-label="Discard attachments"
        onClick={onClear}
        className="flex size-4 items-center justify-center rounded-full transition-colors hover:bg-foreground/10 hover:text-foreground"
      >
        <X size={9} aria-hidden />
      </button>
    </span>
  );
}

/** The reminder-style first row: type, Enter, task exists, focus stays. */
function QuickAddRow({ port, projectId }: { port: number; projectId: string }) {
  const quick = useQuickAddTodo(port, projectId);

  // The row reads exactly like its sibling task rows: no input box. Focus is a
  // quiet wash and the focus line on the whole row, so the input opts out of
  // the fallback line with data-noring.
  return (
    <div className="mx-1.5 flex min-h-7 flex-col justify-center gap-1 rounded-md px-2.5 py-1 transition-colors focus-within:bg-foreground/5 has-[input:focus-visible]:focus-line-inset">
      <div className="flex w-full items-center gap-2">
        <RowIcon>
          <Plus />
        </RowIcon>
        <input
          ref={quick.inputRef}
          data-testid="session-panel-tasks-new"
          data-noring
          value={quick.draft}
          disabled={quick.adding}
          onChange={(event) => quick.setDraft(event.target.value)}
          onPaste={quick.onPaste}
          onKeyDown={quick.onKeyDown}
          aria-label="New task"
          placeholder="New task"
          className="min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
      </div>
      {quick.pending.length > 0 && <AttachmentCountChip count={quick.pending.length} onClear={quick.clearPending} />}
    </div>
  );
}

export function TasksSection() {
  const { projectId } = useActiveIdentity();
  const port = useDaemonPort();
  const load = useTodosStore((s) => s.load);
  // The card follows the active session while the Kanban modal follows its own
  // scope, so it reads its project's bucket rather than a shared list.
  const { todos } = useTodosStore(selectProjectTodos(projectId ?? null));
  const openEdit = useTasksModal((s) => s.openEdit);

  useEffect(() => {
    if (projectId != null) void load(port, projectId);
  }, [port, projectId, load]);

  const active = newestFirst(todos.filter((t) => t.status !== 'done'));
  const [expandedIn, setExpandedIn] = useState<string>();
  const all = projectId != null && expandedIn === projectId;

  return (
    <PanelSection section="tasks" data-testid="session-panel-card-tasks">
      {projectId == null ? (
        <PanelEmpty data-testid="session-panel-tasks-no-project">No active project</PanelEmpty>
      ) : (
        <>
          <QuickAddRow port={port} projectId={projectId} />
          {active.length === 0 && (
            <PanelEmpty data-testid="session-panel-tasks-empty">No open project tasks</PanelEmpty>
          )}
          {(all ? active : active.slice(0, TASKS_SHOWN)).map((todo) => (
            <PanelRow
              key={todo.id}
              data-testid={`session-panel-task-row-${todo.number}`}
              onClick={() => openEdit({ projectId, todoId: todo.id })}
              label={todo.title}
              value={`#${todo.number}`}
            />
          ))}
          {active.length > TASKS_SHOWN && (
            <ShowAllRow
              testId="session-panel-tasks-all"
              count={active.length}
              all={all}
              onToggle={() => setExpandedIn(all ? undefined : projectId)}
            />
          )}
        </>
      )}
    </PanelSection>
  );
}
