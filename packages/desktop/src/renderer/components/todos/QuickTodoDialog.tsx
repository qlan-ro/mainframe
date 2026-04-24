import { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { usePluginLayoutStore } from '../../store/plugins';
import { LabelAutocomplete } from './LabelAutocomplete';
import { ImageLightbox } from '../chat/ImageLightbox';
import { todosApi } from '../../lib/api/todos-api';
import { getActiveProjectId } from '../../hooks/useActiveProjectId';
import { toast } from '../../lib/toast';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:quick-todo');

const MAX_SIZE = 10 * 1024 * 1024;

interface PendingFile {
  id: string;
  filename: string;
  mimeType: string;
  data: string;
  sizeBytes: number;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

type QuickType = 'bug' | 'feature';
type QuickPriority = 'low' | 'medium' | 'high';

// Physical padding properties (pl-*/pr-*) are used instead of the logical px-* shorthand.
// Chromium does not scroll <input> elements correctly to the start of text when
// padding-inline is used — the first character ends up clipped behind the left border.
const input = cn(
  'bg-mf-app-bg border border-mf-border rounded-mf-input pl-3 pr-3 py-1.5',
  'text-mf-small text-mf-text-primary focus:outline-none focus:border-mf-accent',
);

// Scrollable textareas need the border/padding on a wrapping div, because a
// textarea's own padding-bottom is consumed at scroll-end — content would sit
// flush against the bottom border once the user types past the visible rows.
const textareaWrap = cn(
  'bg-mf-app-bg border border-mf-border rounded-mf-input pl-3 pr-3 py-1.5',
  'focus-within:border-mf-accent',
);
const textareaInner = cn(
  'w-full bg-transparent border-0 p-0 resize-none',
  'text-mf-small text-mf-text-primary outline-none focus:outline-none focus-visible:outline-none',
);

const pillBase = cn('px-3 py-1 text-mf-small rounded-full border transition-colors cursor-pointer');

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        pillBase,
        active
          ? 'bg-mf-accent text-white border-mf-accent'
          : 'bg-mf-app-bg text-mf-text-secondary border-mf-border hover:border-mf-text-secondary',
      )}
    >
      {label}
    </button>
  );
}

export function QuickTodoDialog() {
  const triggeredAction = usePluginLayoutStore((s) => s.triggeredAction);
  const clearTriggeredAction = usePluginLayoutStore((s) => s.clearTriggeredAction);

  const isTriggered = triggeredAction?.pluginId === 'todos' && triggeredAction?.actionId === 'quick-create';

  const [type, setType] = useState<QuickType>('feature');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<QuickPriority>('medium');
  const [labelList, setLabelList] = useState<string[]>([]);
  const [allLabels, setAllLabels] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [open, setOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const titleRef = useRef<HTMLInputElement>(null);

  // Open when triggered, reset form and load label suggestions
  useEffect(() => {
    if (isTriggered) {
      setOpen(true);
      setType('feature');
      setTitle('');
      setBody('');
      setPriority('medium');
      setLabelList([]);
      setSubmitting(false);
      setPendingFiles([]);
      clearTriggeredAction();
      requestAnimationFrame(() => titleRef.current?.focus());
      const projectId = getActiveProjectId();
      if (projectId) {
        todosApi
          .list(projectId)
          .then((todos) => {
            const seen = new Set<string>();
            for (const todo of todos) {
              for (const l of todo.labels) seen.add(l);
            }
            setAllLabels([...seen].sort());
          })
          .catch(() => {
            /* expected — not critical */
          });
      }
    }
  }, [isTriggered, clearTriggeredAction]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const addImageFile = useCallback(async (file: File) => {
    if (file.size > MAX_SIZE || !file.type.startsWith('image/')) return;
    try {
      const data = await fileToBase64(file);
      setPendingFiles((prev) => [
        ...prev,
        { id: crypto.randomUUID(), filename: file.name, mimeType: file.type, data, sizeBytes: file.size },
      ]);
    } catch (err) {
      log.warn('Failed to process image', { err: String(err) });
    }
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = Array.from(e.clipboardData.items);
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      if (!imageItem) return;
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (file) void addImageFile(file);
    },
    [addImageFile],
  );

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || submitting) return;

    const projectId = getActiveProjectId();
    if (!projectId) {
      toast.error('No active project');
      return;
    }

    setSubmitting(true);
    try {
      const todo = await todosApi.create({
        projectId,
        title: title.trim(),
        body: body.trim() || undefined,
        type,
        priority,
        labels: labelList.length > 0 ? labelList : undefined,
      });

      if (pendingFiles.length > 0) {
        await Promise.all(
          pendingFiles.map((f) =>
            todosApi.uploadAttachment(todo.id, {
              filename: f.filename,
              mimeType: f.mimeType,
              data: f.data,
              sizeBytes: f.sizeBytes,
            }),
          ),
        );
      }

      toast.success(`Task #${todo.number} created: ${todo.title}`);
      window.dispatchEvent(new CustomEvent('todos:changed'));
      setOpen(false);
    } catch {
      toast.error('Failed to create task');
      setSubmitting(false);
    }
  }, [title, body, type, priority, labelList, submitting, pendingFiles]);

  if (!open) return null;

  const handleModEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        className="bg-mf-panel-bg rounded-mf-panel border border-mf-border w-full max-w-md mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-mf-border">
          <h2 className="text-mf-small font-medium text-mf-text-primary">Quick Task</h2>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3">
          {/* Type toggle */}
          <div className="flex gap-2">
            <Pill label="Feature" active={type === 'feature'} onClick={() => setType('feature')} />
            <Pill label="Bug" active={type === 'bug'} onClick={() => setType('bug')} />
          </div>

          {/* Title */}
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            className={cn(input, 'w-full')}
            onKeyDown={handleModEnter}
          />

          {/* Description */}
          <div className="space-y-1">
            <div className={textareaWrap}>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onPaste={handlePaste}
                placeholder="Details (optional)"
                rows={2}
                className={textareaInner}
                onKeyDown={handleModEnter}
              />
            </div>
            <span className="text-mf-status text-mf-text-secondary opacity-60">Paste image to attach</span>
          </div>

          {/* Pending attachments */}
          {pendingFiles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pendingFiles.map((f, i) => (
                <div
                  key={f.id}
                  className="relative group rounded-mf-input border border-mf-border overflow-hidden bg-mf-app-bg"
                >
                  <button
                    type="button"
                    onClick={() => setLightboxIndex(i)}
                    className="block w-16 h-16 focus:outline-none focus:ring-1 focus:ring-mf-accent"
                    aria-label={`Preview ${f.filename}`}
                  >
                    <img
                      src={`data:${f.mimeType};base64,${f.data}`}
                      alt={f.filename}
                      className="w-full h-full object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingFiles((prev) => prev.filter((p) => p.id !== f.id))}
                    className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label={`Remove ${f.filename}`}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {lightboxIndex !== null && pendingFiles.length > 0 && (
            <ImageLightbox
              images={pendingFiles.map((f) => ({ mediaType: f.mimeType, data: f.data }))}
              index={lightboxIndex}
              onClose={() => setLightboxIndex(null)}
              onNavigate={setLightboxIndex}
            />
          )}

          {/* Priority toggle */}
          <div className="flex items-center gap-2">
            <span className="text-mf-small text-mf-text-secondary">Priority</span>
            <div className="flex gap-1">
              <Pill label="Low" active={priority === 'low'} onClick={() => setPriority('low')} />
              <Pill label="Medium" active={priority === 'medium'} onClick={() => setPriority('medium')} />
              <Pill label="High" active={priority === 'high'} onClick={() => setPriority('high')} />
            </div>
          </div>

          {/* Labels */}
          <LabelAutocomplete value={labelList} onChange={setLabelList} allLabels={allLabels} />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-mf-border">
          <span className="text-mf-tiny text-mf-text-tertiary">
            <kbd className="px-1 py-0.5 bg-mf-app-bg rounded border border-mf-border text-mf-tiny">Esc</kbd> to cancel
          </span>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
            className={cn(
              'px-3 py-1.5 text-mf-small rounded-mf-input transition-colors',
              'bg-mf-accent text-white hover:opacity-90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {submitting ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
