/**
 * TasksCard — the project's active tasks as a stacked panel (moved out of the
 * left sidebar, todo item 4). Owns the project-scoped todos load now that the
 * sidebar section is gone; the store's own sequence guard makes the board's
 * loader harmless rather than racy.
 *
 * Reminder-style entry: the first row IS the create input — type a title,
 * Enter adds the task and keeps focus for the next one. Pasting images while
 * typing holds them as pending attachments (a quiet count chip under the row)
 * and uploads them right after the create resolves — the same
 * pending-then-flush shape the edit modal uses for an unsaved todo. Rows open
 * the edit modal for everything richer. Without an active project there is
 * nothing to scope to, so the card says so instead of rendering an empty list
 * that reads as "no tasks".
 */
import { useEffect, useState } from 'react';
import { ListTodo, Paperclip, Plus, X } from 'lucide-react';
import { mfToast } from '@/lib/toast';
import { uploadAttachment, type Todo } from '@/lib/api/todos';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useTodosStore } from '@/features/tasks/use-todos-store';
import { useStartTodoSession } from '@/features/tasks/use-start-todo-session';
import { extractAllLabels } from '@/features/tasks/todos-filters';
import { TaskEditModal } from '@/features/tasks/sidebar/TaskEditModal';
import { readBase64, rejectFile, type PendingAttachment } from '@/features/tasks/sidebar/use-task-attachments';
import { PanelCard } from './PanelCard';

const ROW = 'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-foreground/8';

/** Pasted files held until the create gives them a todo to attach to. */
function usePendingPaste() {
  const [pending, setPending] = useState<PendingAttachment[]>([]);

  const addFile = async (file: File): Promise<void> => {
    const rejected = rejectFile(file);
    if (rejected !== null) {
      mfToast.error('Attachment not added', { description: rejected });
      return;
    }
    const data = await readBase64(file);
    setPending((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        filename: file.name || 'pasted-image.png',
        mimeType: file.type,
        data,
        sizeBytes: file.size,
      },
    ]);
  };

  const onPaste = (event: React.ClipboardEvent): void => {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    for (const file of files) void addFile(file);
  };

  return { pending, onPaste, clear: () => setPending([]) };
}

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
  const create = useTodosStore((s) => s.create);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const { pending, onPaste, clear } = usePendingPaste();

  const submit = async (): Promise<void> => {
    const title = draft.trim();
    if (title.length === 0 || adding) return;
    setAdding(true);
    try {
      const todo = await create(port, { title }, projectId);
      const results = await Promise.allSettled(
        pending.map(({ filename, mimeType, data, sizeBytes }) =>
          uploadAttachment(port, todo.id, { filename, mimeType, data, sizeBytes }),
        ),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) mfToast.error(`Couldn't upload ${failed} attachment${failed === 1 ? '' : 's'}`);
      setDraft('');
      clear();
    } catch (err) {
      mfToast.error('Could not create the task', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setAdding(false);
    }
  };

  // The row reads exactly like its sibling task rows — no input box, no focus
  // ring (data-noring opts out of the global island ring); focus is a quiet
  // wash on the whole row, Reminders-style.
  return (
    <div className="flex w-full flex-col gap-1 rounded-md px-2 py-1 transition-colors focus-within:bg-foreground/5">
      <div className="flex w-full items-center gap-2">
        <Plus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          data-testid="session-panel-tasks-new"
          data-noring
          value={draft}
          disabled={adding}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={onPaste}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void submit();
            }
            if (event.key === 'Escape') setDraft('');
          }}
          placeholder="New task"
          className="min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
      </div>
      {pending.length > 0 && <AttachmentCountChip count={pending.length} onClear={clear} />}
    </div>
  );
}

export function TasksCard({ onClose }: { onClose: () => void }) {
  const { projectId } = useActiveIdentity();
  const port = useDaemonPort();
  const { load, todos } = useTodosStore();
  const startTodoSession = useStartTodoSession(port, projectId);
  const [editTodo, setEditTodo] = useState<Todo | undefined>(undefined);

  useEffect(() => {
    if (projectId != null) void load(port, projectId);
  }, [port, projectId, load]);

  // The card stays mounted across a project switch; an open edit modal must
  // not survive it with the old todo under the new project (same reason
  // ActivityCard resets its drill-in on chatId).
  useEffect(() => setEditTodo(undefined), [projectId]);

  const active = todos.filter((t) => t.status !== 'done');

  return (
    <PanelCard
      id="tasks"
      label="Tasks"
      icon={ListTodo}
      count={projectId != null && active.length > 0 ? active.length : undefined}
      onClose={onClose}
    >
      <div className="flex flex-col gap-0.5 p-2">
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
                  onClick={() => setEditTodo(todo)}
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

      {editTodo !== undefined && projectId != null && (
        <TaskEditModal
          port={port}
          projectId={projectId}
          todo={editTodo}
          allTodos={todos}
          allLabels={extractAllLabels(todos)}
          onClose={() => setEditTodo(undefined)}
          onStartSession={(id) => {
            const todo = todos.find((t) => t.id === id);
            if (todo) void startTodoSession(todo.id);
            setEditTodo(undefined);
          }}
        />
      )}
    </PanelCard>
  );
}
