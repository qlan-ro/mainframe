/**
 * Form state for the task edit modal.
 *
 * Create and edit differ in one place only: a new todo has nowhere to upload
 * attachments to, so they queue in `pending` and flush right after `create`
 * resolves with an id.
 */
import { useCallback, useState, type ClipboardEvent, type FormEvent } from 'react';
import { mfToast } from '@/lib/toast';
import { uploadAttachment, type Todo, type TodoPriority, type TodoStatus, type TodoType } from '@/lib/api/todos';
import { useTodosStore } from '@/features/tasks/use-todos-store';
import { readBase64, rejectFile, type PendingAttachment } from './use-task-attachments';

interface Options {
  port: number;
  projectId: string;
  todo?: Todo | null;
  onClose: () => void;
}

export function useTaskForm({ port, projectId, todo, onClose }: Options) {
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

  const attachPasted = useCallback(async (e: ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (!file) return;
    const reason = rejectFile(file);
    if (reason) {
      setAttachErr(reason);
      return;
    }
    const data = await readBase64(file);
    setPending((prev) => [
      ...prev,
      { id: crypto.randomUUID(), filename: file.name, mimeType: file.type, data, sizeBytes: file.size },
    ]);
  }, []);

  const submit = useCallback(
    async (e: FormEvent) => {
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
          await Promise.all(pending.map(({ id: _, ...file }) => uploadAttachment(port, created.id, file)));
        }
        onClose();
      } catch (err) {
        console.warn('[tasks] save task failed', err);
        mfToast.error('Failed to save task');
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
      pending,
      saving,
      todo,
      port,
      projectId,
      create,
      update,
      onClose,
    ],
  );

  const destroy = useCallback(async () => {
    if (!todo) return;
    await remove(port, todo.id, projectId);
    onClose();
  }, [todo, port, projectId, remove, onClose]);

  return {
    fields: { title, body, status, type, priority, labelList, assignees, milestone, dependencies },
    set: {
      title: setTitle,
      body: setBody,
      status: setStatus,
      type: setType,
      priority: setPriority,
      labelList: setLabelList,
      assignees: setAssignees,
      milestone: setMilestone,
      dependencies: setDependencies,
    },
    pending,
    setPending,
    attachErr,
    setAttachErr,
    attachPasted,
    saving,
    submit,
    destroy,
  };
}
