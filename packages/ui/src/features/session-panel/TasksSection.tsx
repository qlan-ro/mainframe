/**
 * TasksSection — the project's active tasks as a section of the docked panel
 * (moved out of the left sidebar, todo item 4). Owns the project-scoped todos load now that the
 * sidebar section is gone; the store's own sequence guard makes the board's
 * loader harmless rather than racy.
 *
 * Reminder-style entry: the first row IS the create input — type a title,
 * Enter adds the task and keeps focus for the next one (`useQuickAddTodo`,
 * shared with the sidebar Tasks list). Rows open the ONE task edit modal
 * (`useTasksModal.openEdit`, mounted in `TasksModalHost`). Without an active
 * project there is nothing to scope to, so the card says so instead of
 * rendering an empty list that reads as "no tasks".
 */
import { useEffect } from 'react';
import { Paperclip, Plus, X } from 'lucide-react';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useTodosStore, selectProjectTodos } from '@/features/tasks/use-todos-store';
import { useTasksModal } from '@/features/tasks/use-tasks-modal';
import { useQuickAddTodo } from '@/features/tasks/use-quick-add-todo';
import { newestFirst } from '@/features/tasks/todos-filters';
import { PanelEyebrow } from './PanelEyebrow';

const ROW = 'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-foreground/8';

function AttachmentCountChip({ count, onClear }: { count: number; onClear: () => void }) {
  // Indented to the text column (14px glyph + 8px gap), sized like the row
  // badges elsewhere in the panel.
  return (
    <span
      data-testid="session-panel-tasks-attachments"
      className="ml-[22px] inline-flex h-[18px] w-fit items-center gap-1 rounded-full bg-muted pr-0.5 pl-1.5 text-xs text-muted-foreground"
    >
      <Paperclip size={10} aria-hidden />
      {count} attachment{count === 1 ? '' : 's'}
      <button
        type="button"
        data-testid="session-panel-tasks-attachments-clear"
        aria-label="Discard attachments"
        onClick={onClear}
        className="flex size-3.5 items-center justify-center rounded-full transition-colors hover:bg-foreground/10 hover:text-foreground"
      >
        <X size={9} aria-hidden />
      </button>
    </span>
  );
}

/** The reminder-style first row: type, Enter, task exists, focus stays. */
function QuickAddRow({ port, projectId }: { port: number; projectId: string }) {
  const quick = useQuickAddTodo(port, projectId);

  // The row reads exactly like its sibling task rows — no input box, no focus
  // ring (data-noring opts out of the global island ring); focus is a quiet
  // wash on the whole row, Reminders-style.
  return (
    <div className="flex w-full flex-col gap-1 rounded-md px-2 py-1 transition-colors focus-within:bg-foreground/5">
      <div className="flex w-full items-center gap-2">
        <Plus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={quick.inputRef}
          data-testid="session-panel-tasks-new"
          data-noring
          value={quick.draft}
          disabled={quick.adding}
          onChange={(event) => quick.setDraft(event.target.value)}
          onPaste={quick.onPaste}
          onKeyDown={quick.onKeyDown}
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

  return (
    <section data-testid="session-panel-card-tasks" className="shrink-0">
      <PanelEyebrow label="Tasks" />
      <div className="flex flex-col gap-0.5 px-2 pb-2">
        {projectId == null ? (
          <div data-testid="session-panel-tasks-no-project" className="px-2 py-1 text-sm text-muted-foreground">
            No active project
          </div>
        ) : (
          <>
            <QuickAddRow port={port} projectId={projectId} />

            {active.length === 0 ? (
              <div data-testid="session-panel-tasks-empty" className="px-2 py-1 text-sm text-muted-foreground">
                No active tasks
              </div>
            ) : (
              active.map((todo) => (
                <button
                  key={todo.id}
                  type="button"
                  data-testid={`session-panel-task-row-${todo.number}`}
                  onClick={() => openEdit({ projectId, todoId: todo.id })}
                  className={ROW}
                >
                  <span className="shrink-0 text-sm text-primary">#{todo.number}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{todo.title}</span>
                </button>
              ))
            )}
          </>
        )}
      </div>
    </section>
  );
}
