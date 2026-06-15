/**
 * Zustand store for the Tasks/Todos surface.
 *
 * Holds server state for the active project + view/filter UI state.
 * Mutations call lib/api/todos then refresh (refetch-on-mutation;
 * single-window, no WS event for todos).
 *
 * The `port` and `projectId` are passed into load/mutation actions —
 * not held as store state — so the caller threads them from
 * useActiveIdentity() + the port prop.
 */
import { create } from 'zustand';
import {
  listTodos,
  createTodo,
  updateTodo,
  moveTodo,
  deleteTodo,
  type Todo,
  type CreateTodoInput,
  type UpdateTodoInput,
  type TodoStatus,
} from '@/lib/api/todos';
import type { TodoFilters, TodoSort } from './todos-filters';

const DEFAULT_FILTERS: TodoFilters = { types: [], priorities: [], labels: [], search: '' };
const DEFAULT_SORT: TodoSort = { key: 'number', dir: 'desc' };

interface TodosState {
  todos: Todo[];
  loading: boolean;
  error: string | null;
  filters: TodoFilters;
  sort: TodoSort;
  view: 'list' | 'board';
  load: (port: number, projectId: string) => Promise<void>;
  create: (port: number, input: CreateTodoInput, projectId: string) => Promise<Todo>;
  update: (port: number, id: string, input: UpdateTodoInput, projectId: string) => Promise<void>;
  move: (port: number, id: string, status: TodoStatus, projectId: string) => Promise<void>;
  remove: (port: number, id: string, projectId: string) => Promise<void>;
  setFilters: (f: TodoFilters) => void;
  setSort: (s: TodoSort) => void;
  setView: (v: 'list' | 'board') => void;
  resetFilters: () => void;
}

export const useTodosStore = create<TodosState>((set, get) => ({
  todos: [],
  loading: false,
  error: null,
  filters: DEFAULT_FILTERS,
  sort: DEFAULT_SORT,
  view: 'list',

  load: async (port, projectId) => {
    set({ loading: true, error: null });
    try {
      const todos = await listTodos(port, projectId);
      set({ todos, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to load tasks' });
    }
  },

  create: async (port, input, projectId) => {
    const todo = await createTodo(port, { ...input, projectId });
    await get().load(port, projectId);
    return todo;
  },

  update: async (port, id, input, projectId) => {
    await updateTodo(port, id, input);
    await get().load(port, projectId);
  },

  move: async (port, id, status, projectId) => {
    await moveTodo(port, id, status);
    await get().load(port, projectId);
  },

  remove: async (port, id, projectId) => {
    await deleteTodo(port, id);
    await get().load(port, projectId);
  },

  setFilters: (filters) => set({ filters }),
  setSort: (sort) => set({ sort }),
  setView: (view) => set({ view }),
  resetFilters: () => set({ filters: DEFAULT_FILTERS, sort: DEFAULT_SORT }),
}));
