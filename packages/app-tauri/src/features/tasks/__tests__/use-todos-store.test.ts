/**
 * use-todos-store.test.ts
 *
 * Behaviors covered:
 *  1.  load success — todos state is set to the returned list, loading becomes false, error is null.
 *  2.  load error — loading becomes false, error is set to the error message, todos stays [].
 *  3.  load error with non-Error throws — sets error to the fallback string.
 *  4.  create — calls api.createTodo then refetches (load is called with same port+projectId).
 *  5.  update — calls api.updateTodo then refetches.
 *  6.  move — calls api.moveTodo then refetches.
 *  7.  remove — calls api.deleteTodo then refetches.
 *  8.  setFilters — updates filters in state.
 *  9.  setSort — updates sort in state.
 *  10. resetFilters — resets both filters and sort to defaults.
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

import { useTodosStore } from '../use-todos-store';
import * as todosApi from '@/lib/api/todos';
import type { Todo } from '@/lib/api/todos';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PORT = 31415;
const PROJECT_ID = 'proj-abc';

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
      todos: [],
      loading: false,
      error: null,
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
  it('sets todos to the fetched list, loading to false, error to null', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValue([TODO_A, TODO_B]);

    const { result } = renderHook(() => useTodosStore());

    await act(async () => {
      await result.current.load(PORT, PROJECT_ID);
    });

    expect(result.current.todos).toEqual([TODO_A, TODO_B]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
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

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('db unavailable');
    expect(result.current.todos).toEqual([]);
  });

  it('sets error to the fallback string when the thrown value is not an Error instance', async () => {
    vi.mocked(todosApi.listTodos).mockRejectedValue('string error');

    const { result } = renderHook(() => useTodosStore());

    await act(async () => {
      await result.current.load(PORT, PROJECT_ID);
    });

    expect(result.current.error).toBe('Failed to load tasks');
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
  it('resets filters to empty and sort to {key:number, dir:desc}', () => {
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
    expect(result.current.sort).toEqual({ key: 'number', dir: 'desc' });
  });
});
