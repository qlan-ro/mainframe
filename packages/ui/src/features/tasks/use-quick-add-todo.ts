/**
 * use-quick-add-todo — the Reminders-style "type a title, Enter, task exists"
 * entry, shared by the session panel's Tasks card and the sidebar Tasks list.
 * Pasting images while typing holds them as pending attachments and uploads
 * them right after the create resolves — the same pending-then-flush shape
 * the edit modal uses for an unsaved todo.
 */
import { useRef, useState, type ClipboardEvent, type KeyboardEvent, type RefObject } from 'react';
import { mfToast } from '@/lib/toast';
import { uploadAttachment } from '@/lib/api/todos';
import { useTodosStore } from './use-todos-store';
import { readBase64, rejectFile, type PendingAttachment } from './sidebar/use-task-attachments';

export interface QuickAddTodo {
  draft: string;
  setDraft: (value: string) => void;
  adding: boolean;
  pending: PendingAttachment[];
  clearPending: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onPaste: (event: ClipboardEvent) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  submit: () => Promise<void>;
}

export function useQuickAddTodo(port: number, projectId: string): QuickAddTodo {
  const create = useTodosStore((s) => s.create);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const onPaste = (event: ClipboardEvent): void => {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    for (const file of files) void addFile(file);
  };

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
      setPending([]);
    } catch (err) {
      mfToast.error('Could not create the task', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setAdding(false);
      // `disabled` blurred the input during the awaited create — refocus after
      // the re-enable renders, or "Enter, next task" needs a click in between.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
    if (event.key === 'Escape') setDraft('');
  };

  return { draft, setDraft, adding, pending, clearPending: () => setPending([]), inputRef, onPaste, onKeyDown, submit };
}
