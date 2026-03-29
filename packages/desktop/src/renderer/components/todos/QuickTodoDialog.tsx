import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '../../lib/utils';
import { usePluginLayoutStore } from '../../store/plugins';
import { todosApi } from '../../lib/api/todos-api';
import { getActiveProjectId } from '../../hooks/useActiveProjectId';
import { toast } from '../../lib/toast';

type QuickType = 'bug' | 'feature';
type QuickPriority = 'low' | 'medium' | 'high';

const input = cn(
  'bg-mf-app-bg border border-mf-border rounded-mf-input px-2 py-1.5',
  'text-mf-small text-mf-text-primary focus:outline-none focus:border-mf-accent',
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
  const [labels, setLabels] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [open, setOpen] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);

  // Open when triggered, reset form
  useEffect(() => {
    if (isTriggered) {
      setOpen(true);
      setType('feature');
      setTitle('');
      setBody('');
      setPriority('medium');
      setLabels('');
      setSubmitting(false);
      clearTriggeredAction();
      requestAnimationFrame(() => titleRef.current?.focus());
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

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || submitting) return;

    const projectId = getActiveProjectId();
    if (!projectId) {
      toast.error('No active project');
      return;
    }

    setSubmitting(true);
    try {
      const parsedLabels = labels
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);

      const todo = await todosApi.create({
        projectId,
        title: title.trim(),
        body: body.trim() || undefined,
        type,
        priority,
        labels: parsedLabels.length > 0 ? parsedLabels : undefined,
      });

      toast.success(`Task #${todo.number} created`);
      setOpen(false);
    } catch {
      toast.error('Failed to create task');
      setSubmitting(false);
    }
  }, [title, body, type, priority, labels, submitting]);

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
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Details (optional)"
            rows={2}
            className={cn(input, 'w-full resize-none')}
            onKeyDown={handleModEnter}
          />

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
          <input
            type="text"
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
            placeholder="Labels (comma-separated)"
            className={cn(input, 'w-full')}
            onKeyDown={handleModEnter}
          />
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
