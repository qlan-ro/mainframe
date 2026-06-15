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
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTodosStore } from './use-todos-store';
import { TaskAttachments, type PendingAttachment } from './TaskAttachments';
import { TaskMetaFields } from './TaskMetaFields';
import type { Todo, TodoStatus, TodoType, TodoPriority } from '@/lib/api/todos';

const TYPES: TodoType[] = [
  'bug',
  'feature',
  'enhancement',
  'documentation',
  'question',
  'wont_fix',
  'duplicate',
  'invalid',
];
const PRIORITIES: TodoPriority[] = ['low', 'medium', 'high', 'critical'];
const STATUSES: TodoStatus[] = ['open', 'in_progress', 'done'];

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
    if (!file) return;
    const MAX = 10 * 1024 * 1024;
    if (file.size > MAX || !file.type.startsWith('image/')) {
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

  const uploadPending = useCallback(
    async (todoId: string) => {
      const { uploadAttachment } = await import('@/lib/api/todos');
      await Promise.all(
        pending.map((f) =>
          uploadAttachment(port, todoId, {
            filename: f.filename,
            mimeType: f.mimeType,
            data: f.data,
            sizeBytes: f.sizeBytes,
          }),
        ),
      );
    },
    [port, pending],
  );

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
          if (pending.length > 0) await uploadPending(created.id);
        }
        onClose();
      } catch {
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
      uploadPending,
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
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg w-full max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b border-border shrink-0">
          <DialogTitle className="text-body font-medium">{todo ? 'Edit Task' : 'New Task'}</DialogTitle>
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

            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-caption text-muted-foreground">Type</label>
                <Select value={type} onValueChange={(v) => setType(v as TodoType)}>
                  <SelectTrigger data-testid="tasks-edit-type" className="text-caption h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t.replace('_', ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-caption text-muted-foreground">Priority</label>
                <Select value={priority} onValueChange={(v) => setPriority(v as TodoPriority)}>
                  <SelectTrigger data-testid="tasks-edit-priority" className="text-caption h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-caption text-muted-foreground">Status</label>
                <Select value={status} onValueChange={(v) => setStatus(v as TodoStatus)}>
                  <SelectTrigger data-testid="tasks-edit-status" className="text-caption h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.replace('_', ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between">
                <label className="text-caption text-muted-foreground">Description (markdown)</label>
                <span className="text-caption text-muted-foreground opacity-60">Paste image to attach</span>
              </div>
              <div className={textareaWrap}>
                <textarea
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
                className="px-3 py-1.5 rounded-md text-caption text-primary hover:bg-primary/10 transition-colors"
              >
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
              {saving ? 'Saving…' : todo ? 'Save changes' : 'Save task'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
