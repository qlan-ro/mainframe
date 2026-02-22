import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Todo, CreateTodoInput, TodoStatus, TodoType, TodoPriority } from '../../lib/api/todos-api';

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

interface Props {
  todo?: Todo | null;
  onClose: () => void;
  onSave: (data: CreateTodoInput) => void;
}

const input = cn(
  'bg-mf-app-bg border border-mf-border rounded-mf-input px-2 py-1.5',
  'text-mf-small text-mf-text-primary focus:outline-none focus:border-mf-accent',
);

export function TodoModal({ todo, onClose, onSave }: Props): React.ReactElement {
  const [title, setTitle] = useState(todo?.title ?? '');
  const [body, setBody] = useState(todo?.body ?? '');
  const [status, setStatus] = useState<TodoStatus>(todo?.status ?? 'open');
  const [type, setType] = useState<TodoType>(todo?.type ?? 'feature');
  const [priority, setPriority] = useState<TodoPriority>(todo?.priority ?? 'medium');
  const [labels, setLabels] = useState((todo?.labels ?? []).join(', '));
  const [assignees, setAssignees] = useState((todo?.assignees ?? []).join(', '));
  const [milestone, setMilestone] = useState(todo?.milestone ?? '');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      body: body.trim(),
      status,
      type,
      priority,
      labels: labels
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean),
      assignees: assignees
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
      milestone: milestone.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-mf-panel-bg rounded-mf-panel border border-mf-border w-full max-w-lg mx-4 shadow-xl"
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

        <form onSubmit={handleSubmit} className="p-4 space-y-3 max-h-[80vh] overflow-y-auto">
          <div className="flex flex-col gap-1">
            <label className="text-mf-small text-mf-text-secondary">Title *</label>
            <input
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
            <label className="text-mf-small text-mf-text-secondary">Description (markdown)</label>
            <textarea
              className={cn(input, 'resize-none')}
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe the task..."
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-mf-small text-mf-text-secondary">Labels (comma-separated)</label>
            <input
              className={input}
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              placeholder="e.g. ui, backend, urgent"
            />
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

          <div className="flex justify-end gap-2 pt-1">
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
              {todo ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
