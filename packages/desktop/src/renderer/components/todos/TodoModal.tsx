import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Upload } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Todo, CreateTodoInput, TodoStatus, TodoType, TodoPriority } from '../../lib/api/todos-api';
import { todosApi } from '../../lib/api/todos-api';
import { TodoAttachments } from './TodoAttachments';
import { DependencyPicker } from './DependencyPicker';
import { LabelAutocomplete } from './LabelAutocomplete';
import { ImageLightbox } from '../chat/ImageLightbox';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:todo-modal');

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

export interface PendingAttachment {
  id: string;
  filename: string;
  mimeType: string;
  data: string;
  sizeBytes: number;
}

interface Props {
  todo?: Todo | null;
  allTodos?: Todo[];
  onClose: () => void;
  onSave: (data: CreateTodoInput, pendingAttachments?: PendingAttachment[]) => void;
  onStartSession?: (todo: Todo) => void;
  onSaveAndStartSession?: (data: CreateTodoInput) => void;
  allLabels?: string[];
}

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

const MAX_SIZE = 10 * 1024 * 1024;
const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function TodoModal({
  todo,
  allTodos = [],
  onClose,
  onSave,
  onStartSession,
  allLabels = [],
}: Props): React.ReactElement {
  const [title, setTitle] = useState(todo?.title ?? '');
  const [body, setBody] = useState(todo?.body ?? '');
  const [status, setStatus] = useState<TodoStatus>(todo?.status ?? 'open');
  const [type, setType] = useState<TodoType>(todo?.type ?? 'feature');
  const [priority, setPriority] = useState<TodoPriority>(todo?.priority ?? 'medium');
  const [labelList, setLabelList] = useState<string[]>(todo?.labels ?? []);
  const [assignees, setAssignees] = useState((todo?.assignees ?? []).join(', '));
  const [milestone, setMilestone] = useState(todo?.milestone ?? '');
  const [dependencies, setDependencies] = useState<number[]>(todo?.dependencies ?? []);
  const [size, setSize] = useState({ width: 512, height: 600 });
  const resizing = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  // Attachments for new todos (buffered locally)
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Key to force-refresh TodoAttachments after paste-upload on existing todo
  const [attachRefresh, setAttachRefresh] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      resizing.current = { startX: e.clientX, startY: e.clientY, startW: size.width, startH: size.height };
    },
    [size],
  );

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return;
    const w = Math.max(400, resizing.current.startW + (e.clientX - resizing.current.startX));
    const h = Math.max(300, resizing.current.startH + (e.clientY - resizing.current.startY));
    setSize({ width: w, height: h });
  }, []);

  const onResizeEnd = useCallback(() => {
    resizing.current = null;
  }, []);

  const addImageFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_SIZE) return;
      if (!file.type.startsWith('image/')) return;
      try {
        const data = await fileToBase64(file);
        if (todo) {
          await todosApi.uploadAttachment(todo.id, {
            filename: file.name,
            mimeType: file.type,
            data,
            sizeBytes: file.size,
          });
          setAttachRefresh((n) => n + 1);
        } else {
          setPendingFiles((prev) => [
            ...prev,
            { id: crypto.randomUUID(), filename: file.name, mimeType: file.type, data, sizeBytes: file.size },
          ]);
        }
      } catch (err) {
        log.warn('Failed to process image', { err: String(err) });
      }
    },
    [todo],
  );

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

  const handleFilePick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void addImageFile(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [addImageFile],
  );

  const removePending = useCallback((id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave(
      {
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
      },
      pendingFiles.length > 0 ? pendingFiles : undefined,
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={todo ? 'Edit Task' : 'New Task'}
        className="bg-mf-panel-bg rounded-mf-panel border border-mf-border mx-4 shadow-xl relative flex flex-col overflow-hidden"
        style={{ width: size.width, height: size.height, maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-mf-border">
          <h2 className="text-mf-body font-medium text-mf-text-primary">{todo ? 'Edit Task' : 'New Task'}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3 overflow-y-auto scrollbar-none flex-1 min-h-0">
          <div className="flex flex-col gap-1">
            <label htmlFor="todo-title" className="text-mf-small text-mf-text-secondary">
              Title *
            </label>
            <input
              id="todo-title"
              className={input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              autoFocus
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-mf-small text-mf-text-secondary">Type</label>
              <select
                className={cn(input, 'cursor-pointer capitalize')}
                value={type}
                onChange={(e) => setType(e.target.value as TodoType)}
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-mf-small text-mf-text-secondary">Priority</label>
              <select
                className={cn(input, 'cursor-pointer capitalize')}
                value={priority}
                onChange={(e) => setPriority(e.target.value as TodoPriority)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-mf-small text-mf-text-secondary">Status</label>
              <select
                className={cn(input, 'cursor-pointer capitalize')}
                value={status}
                onChange={(e) => setStatus(e.target.value as TodoStatus)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between">
              <label className="text-mf-small text-mf-text-secondary">Description (markdown)</label>
              <span className="text-mf-status text-mf-text-secondary opacity-60">Paste image to attach</span>
            </div>
            <div className={textareaWrap}>
              <textarea
                className={textareaInner}
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onPaste={handlePaste}
                placeholder="Describe the task..."
              />
            </div>
          </div>

          {/* Attachments: existing todo uses TodoAttachments, new todo shows pending previews */}
          {todo ? (
            <TodoAttachments key={attachRefresh} todoId={todo.id} />
          ) : (
            <div className="flex flex-col gap-1">
              <label className="text-mf-small text-mf-text-secondary">Attachments</label>
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
                        className="block w-20 h-20 focus:outline-none focus:ring-1 focus:ring-mf-accent"
                        aria-label={`Preview ${f.filename}`}
                      >
                        <img
                          src={`data:${f.mimeType};base64,${f.data}`}
                          alt={f.filename}
                          className="w-full h-full object-cover"
                        />
                      </button>
                      <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 pointer-events-none">
                        <span className="text-mf-status text-white truncate block">{f.filename}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removePending(f.id)}
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
              <input
                ref={fileInputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                onChange={handleFilePick}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 w-fit px-2 py-1 rounded-mf-input text-mf-small text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors"
              >
                <Upload size={12} />
                Add image
              </button>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-mf-small text-mf-text-secondary">Labels</label>
            <LabelAutocomplete value={labelList} onChange={setLabelList} allLabels={allLabels} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-mf-small text-mf-text-secondary">Assignees (comma-separated)</label>
            <input
              className={input}
              value={assignees}
              onChange={(e) => setAssignees(e.target.value)}
              placeholder="e.g. alice, bob"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-mf-small text-mf-text-secondary">Milestone</label>
            <input
              className={input}
              value={milestone}
              onChange={(e) => setMilestone(e.target.value)}
              placeholder="e.g. v1.0, Q1 2026"
            />
          </div>

          <DependencyPicker
            currentId={todo?.id}
            currentNumber={todo?.number}
            allTodos={allTodos}
            value={dependencies}
            onChange={setDependencies}
            inputClass={input}
          />

          <div className="flex justify-end gap-2 pt-1">
            {todo && todo.status === 'in_progress' && onStartSession && (
              <button
                type="button"
                onClick={() => {
                  onStartSession(todo);
                  onClose();
                }}
                className="mr-auto px-3 py-1.5 rounded-mf-input text-mf-small text-mf-accent hover:bg-mf-accent/10 transition-colors"
              >
                Start Session
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-mf-input text-mf-small text-mf-text-secondary hover:bg-mf-hover transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="px-3 py-1.5 rounded-mf-input text-mf-small bg-mf-accent text-white disabled:opacity-40 hover:bg-mf-accent/90 transition-colors"
            >
              {todo ? 'Save Changes' : 'Save Task'}
            </button>
          </div>
        </form>
        {/* Resize handle */}
        <div
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onLostPointerCapture={onResizeEnd}
          className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize flex items-end justify-end p-0.5 touch-none"
          aria-hidden="true"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" className="text-mf-text-secondary">
            <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1" opacity="0.4" />
            <line x1="9" y1="4" x2="4" y2="9" stroke="currentColor" strokeWidth="1" opacity="0.4" />
            <line x1="9" y1="7" x2="7" y2="9" stroke="currentColor" strokeWidth="1" opacity="0.4" />
          </svg>
        </div>
      </div>
    </div>
  );
}
