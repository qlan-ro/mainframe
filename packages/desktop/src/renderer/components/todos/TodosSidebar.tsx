import React, { useEffect, useState, useCallback } from 'react';
import { ListTodo, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { createLogger } from '../../lib/logger';
import { todosApi, type Todo } from '../../lib/api/todos-api';
import { getActiveProjectId } from '../../hooks/useActiveProjectId';
import { usePluginLayoutStore } from '../../store/plugins';

const log = createLogger('renderer:todos-sidebar');

const STATUS_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  open: Circle,
  in_progress: Loader2,
  done: CheckCircle2,
};

/**
 * Compact todos sidebar — rendered in the `right-top` zone via multi-zone
 * plugin contribution. Shows the active project's open + in-progress todos
 * as a scrollable list. Click an item to open it in the full kanban view.
 */
export function TodosSidebar(): React.ReactElement {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const activateFullview = usePluginLayoutStore((s) => s.activateFullview);

  const load = useCallback(async () => {
    const projectId = getActiveProjectId();
    if (!projectId) {
      setTodos([]);
      setLoading(false);
      return;
    }
    try {
      const all = await todosApi.list(projectId);
      setTodos(all.filter((t) => t.status !== 'done').slice(0, 20));
    } catch (err) {
      log.warn('load todos failed', { err: String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-small">Loading…</div>;
  }

  if (todos.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-mf-text-secondary text-mf-small">
        <ListTodo size={20} />
        <span>No active todos</span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-mf-border flex items-center gap-2">
        <ListTodo size={14} className="text-mf-accent" />
        <span className="text-mf-small text-mf-text-primary font-medium">Active tasks</span>
        <span className="text-mf-status text-mf-text-secondary ml-auto">{todos.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {todos.map((t) => {
          const Icon = STATUS_ICONS[t.status] ?? Circle;
          const inProgress = t.status === 'in_progress';
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => activateFullview('todos')}
              className="w-full flex items-start gap-2 px-3 py-1.5 text-left hover:bg-mf-hover/40 transition-colors"
              title={t.title}
            >
              <Icon
                size={12}
                className={`${inProgress ? 'text-mf-accent animate-spin' : 'text-mf-text-secondary'} shrink-0 mt-0.5`}
              />
              <span className="text-mf-small text-mf-text-primary truncate">
                #{t.number} {t.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
