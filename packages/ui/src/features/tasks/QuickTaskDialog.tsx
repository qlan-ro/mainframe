/**
 * QuickTaskDialog — ⌘⇧T quick-add. shadcn Dialog with type toggle
 * (feature/bug), title, body (paste-image-to-attach), priority pills,
 * and ⌘↵ create.
 *
 * Props: { port, projectId, open, onClose }
 * Calls useTodosStore.create on submit; uploads any pending attachments after.
 *
 * Port of packages/app-electron/…/todos/QuickTodoDialog.tsx.
 * Rebuilt on shadcn/ui Dialog + warm-chrome tokens; no mf-* phantom classes.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Zap } from 'lucide-react';
import { mfToast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTodosStore } from './use-todos-store';
import type { TodoType, TodoPriority } from '@/lib/api/todos';

type QuickType = 'feature' | 'bug';
// Critical is intentionally excluded from the fast-capture path (finding 9.16).
type QuickPriority = 'low' | 'medium' | 'high';

interface PendingFile {
  id: string;
  filename: string;
  mimeType: string;
  data: string;
  sizeBytes: number;
}

// Physical padding avoids Chromium scroll-clip bug.
const inputCls = cn(
  'bg-background border border-border rounded-md pl-3 pr-3 py-1.5',
  'text-caption text-foreground placeholder:text-muted-foreground',
  'focus:outline-none focus:ring-1 focus:ring-ring w-full',
);
const textareaWrap = cn(
  'bg-background border border-border rounded-md pl-3 pr-3 py-1.5 focus-within:ring-1 focus-within:ring-ring',
);
const textareaInner = cn(
  'w-full bg-transparent border-0 p-0 resize-none text-caption text-foreground outline-none focus:outline-none focus-visible:outline-none',
);
const pillBase = cn('px-3 py-1 text-caption rounded-full border transition-colors cursor-pointer');

function TypePill({
  label,
  active,
  onClick,
  testId,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        pillBase,
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background text-muted-foreground border-border hover:border-foreground',
      )}
    >
      {label}
    </button>
  );
}

interface Props {
  port: number;
  projectId: string;
  open: boolean;
  onClose: () => void;
}

export function QuickTaskDialog({ port, projectId, open, onClose }: Props) {
  const { create } = useTodosStore();
  const [taskType, setTaskType] = useState<QuickType>('feature');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<QuickPriority>('medium');
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // Reset form each time it opens
  useEffect(() => {
    if (!open) return;
    setTaskType('feature');
    setTitle('');
    setBody('');
    setPriority('medium');
    setPending([]);
    setSubmitting(false);
    requestAnimationFrame(() => titleRef.current?.focus());
  }, [open]);

  const addImageFile = useCallback(async (file: File) => {
    if (file.size > 10 * 1024 * 1024 || !file.type.startsWith('image/')) return;
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

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const imageItem = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'));
      if (!imageItem) return;
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (file) void addImageFile(file);
    },
    [addImageFile],
  );

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      const created = await create(
        port,
        {
          projectId,
          title: title.trim(),
          body: body.trim() || undefined,
          type: taskType as TodoType,
          priority: priority as TodoPriority,
        },
        projectId,
      );
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
      onClose();
    } catch (err) {
      console.warn('[tasks] create task failed', err);
      mfToast.error('Failed to create task');
      setSubmitting(false);
    }
  }, [title, body, taskType, priority, pending, submitting, port, projectId, create, onClose]);

  const handleModEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        hideClose
        data-testid="tasks-quick-dialog"
        className="max-w-md w-full max-h-[90vh] flex flex-col p-0 gap-0"
      >
        <DialogHeader className="px-4 py-3 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-1.5 text-body font-bold">
            <Zap size={13} className="text-primary shrink-0" aria-hidden />
            Quick Task
          </DialogTitle>
        </DialogHeader>

        <div className="px-4 py-3 space-y-3 overflow-y-auto flex-1 min-h-0">
          {/* Type toggle */}
          <div className="flex gap-2">
            <TypePill
              label="Feature"
              active={taskType === 'feature'}
              onClick={() => setTaskType('feature')}
              testId="tasks-quick-feature"
            />
            <TypePill
              label="Bug"
              active={taskType === 'bug'}
              onClick={() => setTaskType('bug')}
              testId="tasks-quick-bug"
            />
          </div>

          {/* Title */}
          <input
            ref={titleRef}
            data-testid="tasks-quick-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            className={inputCls}
            onKeyDown={handleModEnter}
          />

          {/* Body */}
          <div className="space-y-1">
            <div className={textareaWrap}>
              <textarea
                data-testid="tasks-quick-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onPaste={handlePaste}
                placeholder="Details (optional)"
                rows={2}
                className={textareaInner}
                onKeyDown={handleModEnter}
              />
            </div>
            <span className="text-caption text-muted-foreground opacity-60">Paste image to attach</span>
          </div>

          {/* Pending attachments */}
          {pending.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pending.map((f) => (
                <div
                  key={f.id}
                  className="relative group rounded-md border border-border overflow-hidden bg-background"
                >
                  <img
                    src={`data:${f.mimeType};base64,${f.data}`}
                    alt={f.filename}
                    className="w-16 h-16 object-cover block"
                  />
                  <button
                    type="button"
                    onClick={() => setPending((prev) => prev.filter((p) => p.id !== f.id))}
                    className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label={`Remove ${f.filename}`}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Priority pills */}
          <div className="flex items-center gap-2">
            <span className="text-caption text-muted-foreground">Priority</span>
            <div className="flex gap-1">
              {(['low', 'medium', 'high'] as const).map((p) => (
                <TypePill
                  key={p}
                  label={p.charAt(0).toUpperCase() + p.slice(1)}
                  active={priority === p}
                  onClick={() => setPriority(p)}
                  testId={`tasks-quick-priority-${p}`}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-border shrink-0">
          <span className="text-caption text-muted-foreground">
            <kbd className="px-1 py-0.5 bg-muted rounded border border-border text-caption">⌘↵</kbd> to create ·{' '}
            <kbd className="px-1 py-0.5 bg-muted rounded border border-border text-caption">Esc</kbd> to cancel
          </span>
          <button
            type="button"
            data-testid="tasks-quick-create"
            onClick={() => void handleSubmit()}
            disabled={!title.trim() || submitting}
            className={cn(
              'px-3 py-1.5 text-caption rounded-md transition-colors',
              'bg-primary text-primary-foreground hover:opacity-90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
