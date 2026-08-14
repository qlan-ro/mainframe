// @vitest-environment jsdom
/**
 * use-todos-store.test.ts
 *
 * Behaviors covered:
 *  1.  load success — the project's bucket holds the returned list, loading becomes false, error is null.
 *  2.  load error — loading becomes false, error is set to the error message, the bucket's todos stays [].
 *  3.  load error with non-Error throws — sets error to the fallback string.
 *  4.  create — calls api.createTodo then refetches (load is called with same port+projectId).
 *  5.  update — calls api.updateTodo then refetches.
 *  6.  move — calls api.moveTodo then refetches.
 *  7.  remove — calls api.deleteTodo then refetches.
 *  8.  setFilters — updates filters in state.
 *  9.  setSort — updates sort in state.
 *  10. resetFilters — resets both filters and sort to defaults.
 *  11. two projects — loading A then B leaves both readable side by side.
 *  12. per-project sequence guard — a slow load for A never lands in B's bucket,
 *      and a superseded load for B is dropped.
 *  13. mutations refetch only the project they were handed.
 *  14. selectProjectTodos — stable empty entry for null and for unseen projects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock @/lib/api/todos BEFORE importing the store
// ---------------------------------------------------------------------------

vi.mock('@/lib/api/todos', () => ({
  listTodos: vi.fn(),
  createTodo: vi.fn(),
  updateTodo: vi.fn(),
  moveTodo: vi.fn(),
  deleteTodo: vi.fn(),
}));

import { useTodosStore, selectProjectTodos } from '../use-todos-store';
import * as todosApi from '@/lib/api/todos';
import type { Todo } from '@/lib/api/todos';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PORT = 31415;
const PROJECT_ID = 'proj-abc';
const PROJECT_B = 'proj-xyz';

/** The bucket a project's server state lives in, read the way components read it. */
function entry(projectId: string | null) {
  return selectProjectTodos(projectId)(useTodosStore.getState());
}

function makeTodo(overrides: Partial<Todo> & { id: string }): Todo {
  return {
    number: 1,
    project_id: PROJECT_ID,
    title: 'Default title',
    body: '',
    status: 'open',
    type: 'feature',
    priority: 'medium',
    labels: [],
    assignees: [],
    milestone: null,
    dependencies: [],
    order_index: 0,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

const TODO_A = makeTodo({ id: 'todo-a', number: 1, title: 'Todo A' });
const TODO_B = makeTodo({ id: 'todo-b', number: 2, title: 'Todo B' });

// ---------------------------------------------------------------------------
// Reset store + mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset the zustand store to initial state
  act(() => {
    useTodosStore.setState({
      entries: {},
      filters: { types: [], priorities: [], labels: [], search: '' },
      sort: { key: 'number', dir: 'desc' },
      view: 'list',
    });
  });
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. load — success
// ---------------------------------------------------------------------------

describe('useTodosStore.load — success', () => {
  it('sets the bucket todos to the fetched list, loading to false, error to null', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValue([TODO_A, TODO_B]);

    const { result } = renderHook(() => useTodosStore());

    await act(async () => {
      await result.current.load(PORT, PROJECT_ID);
    });

    expect(entry(PROJECT_ID).todos).toEqual([TODO_A, TODO_B]);
    expect(entry(PROJECT_ID).loading).toBe(false);
    expect(entry(PROJECT_ID).error).toBeNull();
  });

  it('calls listTodos with the correct port and projectId', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValue([]);

    const { result } = renderHook(() => useTodosStore());

    await act(async () => {
      await result.current.load(PORT, PROJECT_ID);
    });

    expect(todosApi.listTodos).toHaveBeenCalledOnce();
    expect(todosApi.listTodos).toHaveBeenCalledWith(PORT, PROJECT_ID);
  });

  it('files the fetched list under the project it was loaded for, leaving others untouched', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValue([TODO_A]);

    const { result } = renderHook(() => useTodosStore());

    await act(async () => {
      await result.current.load(PORT, PROJECT_ID);
    });

    expect(entry(PROJECT_ID).todos).toEqual([TODO_A]);
    expect(entry(PROJECT_B).todos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 1b. load — stale-completion guard
// ---------------------------------------------------------------------------

describe('useTodosStore.load — stale-completion guard', () => {
  it('drops the result of an earlier load for a project when a newer load for it has started', async () => {
    let resolve1!: (v: Todo[]) => void;
    const slowPromise = new Promise<Todo[]>((res) => {
      resolve1 = res;
    });
    vi.mocked(todosApi.listTodos)
      .mockImplementationOnce(() => slowPromise)
      .mockResolvedValueOnce([TODO_B]);

    const { result } = renderHook(() => useTodosStore());

    // Start load 1 (slow — not yet resolved)
    let p1!: Promise<void>;
    act(() => {
      p1 = result.current.load(PORT, PROJECT_ID);
    });

    // Start load 2 before load 1 resolves — this increments _loadSeq
    await act(async () => {
      await result.current.load(PORT, PROJECT_ID);
    });

    // Now resolve load 1 with stale data
    await act(async () => {
      resolve1([TODO_A]);
      await p1;
    });

    // Store must hold TODO_B (load 2 result), not TODO_A (stale load 1 result)
    expect(entry(PROJECT_ID).todos).toEqual([TODO_B]);
  });

  it('lets a slow load for one project land after a load for another — the guard is per project', async () => {
    let resolveA!: (v: Todo[]) => void;
    const slowA = new Promise<Todo[]>((res) => {
      resolveA = res;
    });
    vi.mocked(todosApi.listTodos)
      .mockImplementationOnce(() => slowA)
      .mockResolvedValueOnce([TODO_B]);

    const { result } = renderHook(() => useTodosStore());

    let pendingA!: Promise<void>;
    act(() => {
      pendingA = result.current.load(PORT, PROJECT_ID);
    });

    await act(async () => {
      await result.current.load(PORT, PROJECT_B);
    });

    await act(async () => {
      resolveA([TODO_A]);
      await pendingA;
    });

    // A's late response belongs in A's bucket and must not touch B's.
    expect(entry(PROJECT_ID).todos).toEqual([TODO_A]);
    expect(entry(PROJECT_B).todos).toEqual([TODO_B]);
  });
});

// ---------------------------------------------------------------------------
// 1c. load — two projects side by side
// ---------------------------------------------------------------------------

describe('useTodosStore.load — two projects', () => {
  it('keeps both projects readable at once, so the board and the session panel can differ', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValueOnce([TODO_A]).mockResolvedValueOnce([TODO_B]);

    const { result } = renderHook(() => useTodosStore());

    await act(async () => {
      await result.current.load(PORT, PROJECT_ID);
      await result.current.load(PORT, PROJECT_B);
    });

    expect(entry(PROJECT_ID).todos).toEqual([TODO_A]);
    expect(entry(PROJECT_B).todos).toEqual([TODO_B]);
  });

  it('marks only the loading project as loading', async () => {
    vi.mocked(todosApi.listTodos)
      .mockResolvedValueOnce([TODO_A])
      .mockImplementationOnce(() => new Promise<Todo[]>(() => {}));

    const { result } = renderHook(() => useTodosStore());

    await act(async () => {
      await result.current.load(PORT, PROJECT_ID);
    });
    act(() => {
      void result.current.load(PORT, PROJECT_B);
    });

    expect(entry(PROJECT_B).loading).toBe(true);
    expect(entry(PROJECT_ID).loading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. load — error path
// ---------------------------------------------------------------------------

describe('useTodosStore.load — error', () => {
  it('sets loading to false and error to the Error message when listTodos throws', async () => {
    vi.mocked(todosApi.listTodos).mockRejectedValue(new Error('db unavailable'));

    const { result } = renderHook(() => useTodosStore());

    await act(async () => {
      await result.current.load(PORT, PROJECT_ID);
    });

    expect(entry(PROJECT_ID).loading).toBe(false);
    expect(entry(PROJECT_ID).error).toBe('db unavailable');
    expect(entry(PROJECT_ID).todos).toEqual([]);
  });

  it('sets error to the fallback string when the thrown value is not an Error instance', async () => {
    vi.mocked(todosApi.listTodos).mockRejectedValue('string error');

    const { result } = renderHook(() => useTodosStore());

    await act(async () => {
      await result.current.load(PORT, PROJECT_ID);
    });

    expect(entry(PROJECT_ID).error).toBe('Failed to load tasks');
  });

  it('leaves the other bucket alone when one project fails to load', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValueOnce([TODO_B]).mockRejectedValueOnce(new Error('db unavailable'));

    const { result } = renderHook(() => useTodosStore());

    await act(async () => {
      await result.current.load(PORT, PROJECT_B);
      await result.current.load(PORT, PROJECT_ID);
    });

    expect(entry(PROJECT_ID).error).toBe('db unavailable');
    expect(entry(PROJECT_B).error).toBeNull();
    expect(entry(PROJECT_B).todos).toEqual([TODO_B]);
  });
});

// ---------------------------------------------------------------------------
// 3. create
// ---------------------------------------------------------------------------

describe('useTodosStore.create', () => {
  it('calls createTodo then refetches (listTodos called once)', async () => {
    vi.mocked(todosApi.createTodo).mockResolvedValue(TODO_A);
    vi.mocked(todosApi.listTodos).mockResolvedValue([TODO_A]);

    const { result } = renderHook(() => useTodosStore());

    await act(async () => {
      await result.current.create(PORT, { title: 'Todo A' }, PROJECT_ID);
    });

    expect(todosApi.createTodo).toHaveBeenCalledOnce();
    expect(todosApi.createTodo).toHaveBeenCalledWith(PORT, { title: 'Todo A', projectId: PROJECT_ID });

    // refetch
    expect(todosApi.listTodos).toHaveBeenCalledOnce();
    expect(todosApi.listTodos).toHaveBeenCalledWith(PORT, PROJECT_ID);
  });

  it('returns the created todo from createTodo', async () => {
    vi.mocked(todosApi.createTodo).mockResolvedValue(TODO_A);
    vi.mocked(todosApi.listTodos).mockResolvedValue([TODO_A]);

    const { result } = renderHook(() => useTodosStore());

    let created: Todo | undefined;
    await act(async () => {
      created = await result.current.create(PORT, { title: 'Todo A' }, PROJECT_ID);
    });

    expect(created).toEqual(TODO_A);
  });
});

// ---------------------------------------------------------------------------
// 4. update
// ---------------------------------------------------------------------------

describe('useTodosStore.update', () => {
  it('calls updateTodo with the right args then refetches', async () => {
    const updated = { ...TODO_A, title: 'Updated' };
    vi.mocked(todosApi.updateTodo).mockResolvedValue(updated);
    vi.mocked(todosApi.listTodos).mockResolvedValue([updated]);

    const { result } = renderHook(() => useTodosStore());

    await act(async () => {
      await result.current.update(PORT, 'todo-a', { title: 'Updated' }, PROJECT_ID);
    });

    expect(todosApi.updateTodo).toHaveBeenCalledOnce();
    expect(todosApi.updateTodo).toHaveBeenCalledWith(PORT, 'todo-a', { title: 'Updated' });

    expect(todosApi.listTodos).toHaveBeenCalledOnce();
    expect(todosApi.listTodos).toHaveBeenCalledWith(PORT, PROJECT_ID);
  });
});

// ---------------------------------------------------------------------------
// 5. move
// ---------------------------------------------------------------------------

describe('useTodosStore.move', () => {
  it('calls moveTodo with the right status then refetches', async () => {
    const moved = { ...TODO_A, status: 'done' as const };
    vi.mocked(todosApi.moveTodo).mockResolvedValue(moved);
    vi.mocked(todosApi.listTodos).mockResolvedValue([moved]);

    const { result } = renderHook(() => useTodosStore());

    await act(async () => {
      await result.current.move(PORT, 'todo-a', 'done', PROJECT_ID);
    });

    expect(todosApi.moveTodo).toHaveBeenCalledOnce();
    expect(todosApi.moveTodo).toHaveBeenCalledWith(PORT, 'todo-a', 'done');

    expect(todosApi.listTodos).toHaveBeenCalledOnce();
    expect(todosApi.listTodos).toHaveBeenCalledWith(PORT, PROJECT_ID);
  });
});

// ---------------------------------------------------------------------------
// 6. remove
// ---------------------------------------------------------------------------

describe('useTodosStore.remove', () => {
  it('calls deleteTodo then refetches', async () => {
    vi.mocked(todosApi.deleteTodo).mockResolvedValue(undefined);
    vi.mocked(todosApi.listTodos).mockResolvedValue([]);

    const { result } = renderHook(() => useTodosStore());

    await act(async () => {
      await result.current.remove(PORT, 'todo-a', PROJECT_ID);
    });

    expect(todosApi.deleteTodo).toHaveBeenCalledOnce();
    expect(todosApi.deleteTodo).toHaveBeenCalledWith(PORT, 'todo-a');

    expect(todosApi.listTodos).toHaveBeenCalledOnce();
    expect(todosApi.listTodos).toHaveBeenCalledWith(PORT, PROJECT_ID);
  });
});

// ---------------------------------------------------------------------------
// 6b. mutations refetch only the project they were handed
// ---------------------------------------------------------------------------

describe('useTodosStore mutations — project scoping', () => {
  beforeEach(() => {
    vi.mocked(todosApi.createTodo).mockResolvedValue(TODO_B);
    vi.mocked(todosApi.updateTodo).mockResolvedValue(TODO_B);
    vi.mocked(todosApi.moveTodo).mockResolvedValue(TODO_B);
    vi.mocked(todosApi.deleteTodo).mockResolvedValue(undefined);
  });

  it('refetches only the mutated project, leaving the other bucket as it was', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValueOnce([TODO_A]).mockResolvedValue([TODO_B]);

    const { result } = renderHook(() => useTodosStore());

    await act(async () => {
      await result.current.load(PORT, PROJECT_ID);
    });
    await act(async () => {
      await result.current.create(PORT, { title: 'Todo B' }, PROJECT_B);
    });

    expect(todosApi.listTodos).toHaveBeenLastCalledWith(PORT, PROJECT_B);
    expect(entry(PROJECT_B).todos).toEqual([TODO_B]);
    expect(entry(PROJECT_ID).todos).toEqual([TODO_A]);
  });

  it.each([
    ['update', (s: ReturnType<typeof useTodosStore.getState>) => s.update(PORT, 'todo-b', { title: 'x' }, PROJECT_B)],
    ['move', (s: ReturnType<typeof useTodosStore.getState>) => s.move(PORT, 'todo-b', 'done', PROJECT_B)],
    ['remove', (s: ReturnType<typeof useTodosStore.getState>) => s.remove(PORT, 'todo-b', PROJECT_B)],
  ])('%s refetches its own project only', async (_name, run) => {
    vi.mocked(todosApi.listTodos).mockResolvedValueOnce([TODO_A]).mockResolvedValue([TODO_B]);

    const { result } = renderHook(() => useTodosStore());

    await act(async () => {
      await result.current.load(PORT, PROJECT_ID);
    });
    await act(async () => {
      await run(result.current);
    });

    expect(todosApi.listTodos).toHaveBeenLastCalledWith(PORT, PROJECT_B);
    expect(entry(PROJECT_ID).todos).toEqual([TODO_A]);
  });
});

// ---------------------------------------------------------------------------
// 6c. selectProjectTodos — the read seam
// ---------------------------------------------------------------------------

describe('selectProjectTodos', () => {
  it('returns the same empty entry for a null project and for one never loaded', () => {
    const state = useTodosStore.getState();
    const unscoped = selectProjectTodos(null)(state);
    const unseen = selectProjectTodos('never-loaded')(state);

    expect(unscoped.todos).toEqual([]);
    expect(unscoped.loading).toBe(false);
    expect(unscoped.error).toBeNull();
    // One shared instance: a fresh object per read would make the selector
    // return a new snapshot every render and loop useSyncExternalStore.
    expect(unseen).toBe(unscoped);
  });

  it('returns a stable reference across reads while the bucket is unchanged', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValue([TODO_A]);

    const { result } = renderHook(() => useTodosStore());
    await act(async () => {
      await result.current.load(PORT, PROJECT_ID);
    });

    expect(entry(PROJECT_ID)).toBe(entry(PROJECT_ID));
  });
});

// ---------------------------------------------------------------------------
// 7. setFilters
// ---------------------------------------------------------------------------

describe('useTodosStore.setFilters', () => {
  it('updates the filters state in the store', () => {
    const { result } = renderHook(() => useTodosStore());

    act(() => {
      result.current.setFilters({ types: ['bug'], priorities: ['high'], labels: ['auth'], search: 'fix' });
    });

    expect(result.current.filters).toEqual({
      types: ['bug'],
      priorities: ['high'],
      labels: ['auth'],
      search: 'fix',
    });
  });
});

// ---------------------------------------------------------------------------
// 8. setSort
// ---------------------------------------------------------------------------

describe('useTodosStore.setSort', () => {
  it('updates the sort state in the store', () => {
    const { result } = renderHook(() => useTodosStore());

    act(() => {
      result.current.setSort({ key: 'priority', dir: 'asc' });
    });

    expect(result.current.sort).toEqual({ key: 'priority', dir: 'asc' });
  });
});

// ---------------------------------------------------------------------------
// 9. resetFilters
// ---------------------------------------------------------------------------

describe('useTodosStore.resetFilters', () => {
  it('resets filters to empty and sort to {key:priority, dir:asc}', () => {
    const { result } = renderHook(() => useTodosStore());

    // Apply non-default state first
    act(() => {
      result.current.setFilters({ types: ['bug'], priorities: ['critical'], labels: ['auth'], search: 'fix' });
      result.current.setSort({ key: 'type', dir: 'asc' });
    });

    act(() => {
      result.current.resetFilters();
    });

    expect(result.current.filters).toEqual({ types: [], priorities: [], labels: [], search: '' });
    expect(result.current.sort).toEqual({ key: 'priority', dir: 'asc' });
  });
});

// ---------------------------------------------------------------------------
// 10. initial default sort (finding 9.9 — priority-first on open)
// ---------------------------------------------------------------------------

describe('useTodosStore — initial default sort', () => {
  it('defaults to {key:priority, dir:asc} so the board opens priority-first', () => {
    // Reconstruct the store's true initial state (beforeEach above overrides
    // it to isolate other tests); read getState() directly, pre-any-action.
    const initialSort = useTodosStore.getInitialState().sort;
    expect(initialSort).toEqual({ key: 'priority', dir: 'asc' });
  });
});
