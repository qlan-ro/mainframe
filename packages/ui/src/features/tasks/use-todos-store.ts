/**
 * Zustand store for the Tasks/Todos surface.
 *
 * Server state is bucketed by project: the Kanban modal follows its own
 * per-open scope while the session panel's card follows the active session, so
 * the two routinely hold different projects and a single flat list would let
 * whichever loaded last blank the other. View/filter/sort state stays global —
 * it belongs to the user, not to a project.
 *
 * Mutations call lib/api/todos then refresh (refetch-on-mutation;
 * single-window, no WS event for todos).
 *
 * The `port` and `projectId` are passed into load/mutation actions —
 * not held as store state — so the caller threads them from its own scope.
 *
 * Stale-completion guard: a sequence counter per project id. A result is
 * discarded when a newer load for that same project has been issued since,
 * which keeps a slow response for one project from landing in another's bucket.
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
// Priority-first, most-urgent-visible-first on open (design: TD_PRI_RANK
// critical=0, see finding 9.9 + the rank flip in todos-filters.ts, 9.4).
const DEFAULT_SORT: TodoSort = { key: 'priority', dir: 'asc' };

/** One project's server state. */
export interface TodosEntry {
  todos: Todo[];
  loading: boolean;
  error: string | null;
}

// One shared instance for every unloaded project: a fresh object per read would
// hand useSyncExternalStore a new snapshot on every render.
const EMPTY_ENTRY: TodosEntry = Object.freeze({ todos: [] as Todo[], loading: false, error: null });

// Monotonic per project — lives outside React/Zustand so it persists across renders.
const _loadSeq = new Map<string, number>();

interface TodosState {
  entries: Record<string, TodosEntry>;
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

/** Read one project's bucket. `null` — no scope picked yet — reads as empty. */
export function selectProjectTodos(projectId: string | null): (state: TodosState) => TodosEntry {
  return (state) => (projectId === null ? EMPTY_ENTRY : (state.entries[projectId] ?? EMPTY_ENTRY));
}

export const useTodosStore = create<TodosState>((set, get) => ({
  entries: {},
  filters: DEFAULT_FILTERS,
  sort: DEFAULT_SORT,
  view: 'list',

  load: async (port, projectId) => {
    const seq = (_loadSeq.get(projectId) ?? 0) + 1;
    _loadSeq.set(projectId, seq);
    const patch = (entry: TodosEntry) => set((state) => ({ entries: { ...state.entries, [projectId]: entry } }));
    const current = (): TodosEntry => get().entries[projectId] ?? EMPTY_ENTRY;

    patch({ ...current(), loading: true, error: null });
    try {
      const todos = await listTodos(port, projectId);
      // Drop stale result if a newer load for this project has started.
      if (seq !== _loadSeq.get(projectId)) return;
      patch({ todos, loading: false, error: null });
    } catch (err) {
      if (seq !== _loadSeq.get(projectId)) return;
      patch({
        ...current(),
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load tasks',
      });
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
