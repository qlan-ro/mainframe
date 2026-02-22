import React, { useState, useEffect, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { todosApi, type Todo, type TodoStatus, type CreateTodoInput } from '../../lib/api/todos-api';
import { TodoCard } from './TodoCard';
import { TodoModal } from './TodoModal';
import { useProjectsStore } from '../../store';
import { useSkillsStore } from '../../store/skills';
import { daemonClient } from '../../lib/client';

const COLUMNS: { status: TodoStatus; label: string }[] = [
  { status: 'open', label: 'Open' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'done', label: 'Done' },
];

export function TodosPanel(): React.ReactElement {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);

  const loadTodos = useCallback(async () => {
    try {
      setError(null);
      const list = await todosApi.list();
      setTodos(list);
    } catch (err) {
      setError('Failed to load tasks. Is the daemon running?');
      console.warn('[todos] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTodos();
  }, [loadTodos]);

  const handleCreate = useCallback(async (data: CreateTodoInput) => {
    try {
      const todo = await todosApi.create(data);
      setTodos((prev) => [...prev, todo]);
      setModalOpen(false);
    } catch (err) {
      console.warn('[todos] create failed:', err);
    }
  }, []);

  const handleUpdate = useCallback(
    async (data: CreateTodoInput) => {
      if (!editingTodo) return;
      try {
        const updated = await todosApi.update(editingTodo.id, data);
        setTodos((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        setEditingTodo(null);
        setModalOpen(false);
      } catch (err) {
        console.warn('[todos] update failed:', err);
      }
    },
    [editingTodo],
  );

  const handleMove = useCallback(async (id: string, status: TodoStatus) => {
    try {
      const updated = await todosApi.move(id, status);
      setTodos((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      console.warn('[todos] move failed:', err);
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await todosApi.remove(id);
      setTodos((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.warn('[todos] delete failed:', err);
    }
  }, []);

  const handleStartSession = useCallback(
    async (todo: Todo) => {
      if (!activeProjectId) return;
      try {
        const { chatId, initialMessage } = await todosApi.startSession(todo.id, activeProjectId);
        // Pre-fill the composer using the existing pendingInvocation mechanism
        useSkillsStore.getState().setPendingInvocation(initialMessage);
        // chat.created WS event will open the tab automatically
        daemonClient.subscribe(chatId);
      } catch (err) {
        console.warn('[todos] start-session failed:', err);
      }
    },
    [activeProjectId],
  );

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-small">Loading tasks…</div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-mf-text-secondary text-mf-small px-4 text-center">
        <p>{error}</p>
        <button onClick={() => void loadTodos()} className="text-mf-accent hover:underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-11 px-4 flex items-center justify-between shrink-0 border-b border-mf-border">
        <span className="text-mf-small text-mf-text-secondary uppercase tracking-wider">Tasks</span>
        <button
          onClick={() => {
            setEditingTodo(null);
            setModalOpen(true);
          }}
          className="flex items-center gap-1 px-2 py-1 rounded-mf-input text-mf-small text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors"
          title="New Task"
          aria-label="Create new task"
        >
          <Plus size={13} />
          New
        </button>
      </div>

      {/* Columns */}
      <div className="flex-1 flex gap-0 overflow-hidden">
        {COLUMNS.map(({ status, label }) => {
          const colTodos = todos.filter((t) => t.status === status);
          return (
            <div
              key={status}
              className="flex-1 flex flex-col border-r border-mf-border last:border-r-0 overflow-hidden"
            >
              <div className="px-3 py-2 text-mf-small font-medium text-mf-text-secondary flex items-center gap-1.5 shrink-0">
                <span>{label}</span>
                <span className="bg-mf-hover px-1.5 py-0.5 rounded text-mf-status">{colTodos.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                {colTodos.map((todo) => (
                  <TodoCard
                    key={todo.id}
                    todo={todo}
                    onMove={handleMove}
                    onEdit={(t) => {
                      setEditingTodo(t);
                      setModalOpen(true);
                    }}
                    onDelete={handleDelete}
                    onStartSession={handleStartSession}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal */}
      {modalOpen && (
        <TodoModal
          todo={editingTodo}
          onClose={() => {
            setModalOpen(false);
            setEditingTodo(null);
          }}
          onSave={editingTodo ? handleUpdate : handleCreate}
        />
      )}
    </div>
  );
}
