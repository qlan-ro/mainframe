/**
 * QuickTaskForm — the quick-add body: type toggle (feature/bug), title, body
 * (paste-image-to-attach), priority pills, and ⌘↵ create.
 *
 * Split out of QuickTaskDialog when the dialog gained its unresolved-scope
 * state; the shell owns the frame and the project, the form owns the draft.
 * Calls useTodosStore.create on submit; uploads any pending attachments after.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { mfToast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
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

interface Props {
  port: number;
  projectId: string;
  /** Drives the per-open reset — the draft must not survive a close. */
  open: boolean;
  onClose: () => void;
}

export function QuickTaskForm({ port, projectId, open, onClose }: Props) {
  const { create } = useTodosStore();
  const load = useTodosStore((s) => s.load);
  const [taskType, setTaskType] = useState<QuickType>('feature');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<QuickPriority>('medium');
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // Refetch on every open. The store has no WS event (single-window
  // refetch-on-mutation), so a change made outside this window — agent
  // sessions, another window, direct DB writes — would otherwise go unseen.
  useEffect(() => {
    if (!open) return;
    void load(port, projectId);
  }, [open, port, projectId, load]);

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
    <>
      <div className="px-4 py-3 gap-3 overflow-y-auto flex-1 min-h-0">
        {/* Type toggle */}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={taskType}
          onValueChange={(v) => {
            if (v) setTaskType(v as QuickType);
          }}
        >
          <ToggleGroupItem value="feature" data-testid="tasks-quick-feature">
            Feature
          </ToggleGroupItem>
          <ToggleGroupItem value="bug" data-testid="tasks-quick-bug">
            Bug
          </ToggleGroupItem>
        </ToggleGroup>

        {/* Title */}
        <Input
          ref={titleRef}
          data-testid="tasks-quick-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs to be done?"
          onKeyDown={handleModEnter}
        />

        {/* Body */}
        <div className="flex flex-col gap-1">
          <Textarea
            data-testid="tasks-quick-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onPaste={handlePaste}
            placeholder="Details (optional)"
            rows={2}
            className="resize-none"
            onKeyDown={handleModEnter}
          />
          <span className="text-xs text-muted-foreground">Paste image to attach</span>
        </div>

        {/* Pending attachments */}
        {pending.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pending.map((f) => (
              <div key={f.id} className="relative group rounded-md border border-border overflow-hidden bg-background">
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
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Priority */}
        <div className="flex items-center gap-2">
          <Label className="text-muted-foreground">Priority</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={priority}
            onValueChange={(v) => {
              if (v) setPriority(v as QuickPriority);
            }}
          >
            {(['low', 'medium', 'high'] as const).map((p) => (
              <ToggleGroupItem key={p} value={p} data-testid={`tasks-quick-priority-${p}`}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-3 border-t border-border shrink-0">
        <span className="text-xs text-muted-foreground">
          <kbd className="rounded border bg-muted px-1 py-0.5 text-xs">⌘↵</kbd> to create ·{' '}
          <kbd className="rounded border bg-muted px-1 py-0.5 text-xs">Esc</kbd> to cancel
        </span>
        <Button
          size="sm"
          data-testid="tasks-quick-create"
          onClick={() => void handleSubmit()}
          disabled={!title.trim() || submitting}
        >
          {submitting ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </>
  );
}
