/**
 * TaskEditModal — shadcn Dialog for creating or editing a Task/Todo.
 *
 * Create flow: builds CreateTodoInput → useTodosStore.create, then uploads
 * any pending attachments collected by TaskAttachments (new-todo mode).
 * Edit flow: builds UpdateTodoInput → useTodosStore.update, attachments handled
 * directly in TaskAttachments (existing-todo mode).
 *
 * Port of packages/desktop/…/todos/TodoModal.tsx.
 * Rebuilt on shadcn/ui + warm-chrome tokens; mf-* phantom classes removed.
 */
import React, { useState, useCallback } from 'react';
import { Trash2, Pencil, Plus, Play } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTodosStore } from './use-todos-store';
import { TaskAttachments, type PendingAttachment } from './TaskAttachments';
import { TaskMetaFields } from './TaskMetaFields';
import { TaskSelectFields } from './TaskSelectFields';
import type { Todo, TodoStatus, TodoType, TodoPriority } from '@/lib/api/todos';

// Physical padding avoids Chromium scroll-clip on <input>.
const inputCls = cn(
  'bg-background border border-border rounded-md pl-3 pr-3 py-1.5',
  'text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-ring w-full',
);
const textareaWrap = cn(
  'bg-background border border-border rounded-md pl-3 pr-3 py-1.5 focus-within:ring-1 focus-within:ring-ring',
);
const textareaInner = cn(
  'w-full bg-transparent border-0 p-0 resize-none text-caption text-foreground outline-none focus:outline-none focus-visible:outline-none',
);

interface Props {
  port: number;
  projectId: string;
  todo?: Todo | null;
  allTodos: Todo[];
  allLabels: string[];
  onClose: () => void;
  onStartSession?: (todoId: string) => void;
}

export function TaskEditModal({ port, projectId, todo, allTodos, allLabels, onClose, onStartSession }: Props) {
  const { create, update, remove } = useTodosStore();
  const [title, setTitle] = useState(todo?.title ?? '');
  const [body, setBody] = useState(todo?.body ?? '');
  const [status, setStatus] = useState<TodoStatus>(todo?.status ?? 'open');
  const [type, setType] = useState<TodoType>(todo?.type ?? 'feature');
  const [priority, setPriority] = useState<TodoPriority>(todo?.priority ?? 'medium');
  const [labelList, setLabelList] = useState<string[]>(todo?.labels ?? []);
  const [assignees, setAssignees] = useState((todo?.assignees ?? []).join(', '));
  const [milestone, setMilestone] = useState(todo?.milestone ?? '');
  const [dependencies, setDependencies] = useState<number[]>(todo?.dependencies ?? []);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [saving, setSaving] = useState(false);
  const [attachErr, setAttachErr] = useState<string | null>(null);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const imageItem = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file || file.size > 10 * 1024 * 1024) {
      setAttachErr('Image must be under 10 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = (reader.result as string).split(',')[1] ?? '';
      setPending((prev) => [
        ...prev,
        { id: crypto.randomUUID(), filename: file.name, mimeType: file.type, data, sizeBytes: file.size },
      ]);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!title.trim() || saving) return;
      setSaving(true);
      const input = {
        title: title.trim(),
        body: body.trim(),
        status,
        type,
        priority,
        labels: labelList,
        assignees: assignees
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
        milestone: milestone.trim() || undefined,
        dependencies,
      };
      try {
        if (todo) {
          await update(port, todo.id, input, projectId);
        } else {
          const created = await create(port, input, projectId);
          if (pending.length > 0) {
            const { uploadAttachment } = await import('@/lib/api/todos');
            await Promise.all(
              pending.map((f) =>
                uploadAttachment(port, created.id, {
                  filename: f.filename,
                  mimeType: f.mimeType,
                  data: f.data,
                  sizeBytes: f.sizeBytes,
                }),
              ),
            );
          }
        }
        onClose();
      } catch (err) {
        console.warn('[tasks] save task failed', err);
        toast.error('Failed to save task');
        setSaving(false);
      }
    },
    [
      title,
      body,
      status,
      type,
      priority,
      labelList,
      assignees,
      milestone,
      dependencies,
      saving,
      todo,
      port,
      projectId,
      create,
      update,
      pending,
      onClose,
    ],
  );

  const handleDelete = useCallback(async () => {
    if (!todo) return;
    await remove(port, todo.id, projectId);
    onClose();
  }, [todo, port, projectId, remove, onClose]);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-lg w-full max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-heading font-bold">
            {todo ? (
              <>
                <Pencil size={14} className="text-primary shrink-0" aria-hidden />
                Edit Task #{todo.number}
              </>
            ) : (
              <>
                <Plus size={14} className="text-primary shrink-0" aria-hidden />
                New Task
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="p-4 space-y-3 overflow-y-auto flex-1 min-h-0">
            <div className="flex flex-col gap-1">
              <label className="text-caption text-muted-foreground">Title *</label>
              <input
                data-testid="tasks-edit-title"
                className={inputCls}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Task title"
                autoFocus
                required
              />
            </div>

            <TaskSelectFields
              type={type}
              onTypeChange={setType}
              priority={priority}
              onPriorityChange={setPriority}
              status={status}
              onStatusChange={setStatus}
            />

            <div className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between">
                <label className="text-caption text-muted-foreground">Description (markdown)</label>
                <span className="text-caption text-muted-foreground opacity-60">Paste image to attach</span>
              </div>
              <div className={textareaWrap}>
                <textarea
                  data-testid="tasks-edit-body"
                  className={textareaInner}
                  rows={4}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onPaste={handlePaste}
                  placeholder="Describe the task…"
                />
              </div>
            </div>

            {attachErr && <p className="text-caption text-destructive">{attachErr}</p>}

            <TaskAttachments
              port={port}
              todoId={todo?.id}
              pending={pending}
              onPendingChange={setPending}
              onRejectFile={setAttachErr}
            />

            <TaskMetaFields
              labelList={labelList}
              onLabelChange={setLabelList}
              allLabels={allLabels}
              assignees={assignees}
              onAssigneesChange={setAssignees}
              milestone={milestone}
              onMilestoneChange={setMilestone}
              dependencies={dependencies}
              onDepsChange={setDependencies}
              currentNumber={todo?.number}
              allTodos={allTodos}
            />
          </div>

          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
            {todo && (
              <button
                type="button"
                data-testid="tasks-edit-delete"
                onClick={handleDelete}
                className="mr-auto p-1.5 rounded-md text-destructive hover:bg-destructive/10 transition-colors"
                aria-label="Delete task"
              >
                <Trash2 size={14} />
              </button>
            )}
            {todo && todo.status === 'in_progress' && onStartSession && (
              <button
                type="button"
                data-testid="tasks-edit-start"
                onClick={() => {
                  onStartSession(todo.id);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-caption bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity"
              >
                <Play size={12} aria-hidden />
                Start session
              </button>
            )}
            <button
              type="button"
              data-testid="tasks-edit-cancel"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-caption text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="tasks-edit-save"
              disabled={!title.trim() || saving}
              className="px-3 py-1.5 rounded-md text-caption bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {saving ? 'Saving…' : todo ? 'Save changes' : 'Create task'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
