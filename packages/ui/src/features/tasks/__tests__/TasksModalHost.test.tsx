/**
 * TasksModalHost.test.tsx
 *
 * Regression coverage for todo #225: the Tasks modal showed boot-time todos
 * forever because opening it never refetched. These tests exercise the real
 * useTodosStore + useTasksModal against a mocked lib/api/todos, so a fresh
 * listTodos call on open (and quick-add open) is observable end-to-end.
 *
 * Behaviors covered:
 *  1.  Opening the full modal after an external change refetches (listTodos
 *      called again) and renders the fresh statuses.
 *  2.  Opening the quick-add dialog refetches.
 *  3.  Closing then re-opening the modal refetches each time (rising edge).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock lib/api/todos BEFORE importing the store-backed component
// ---------------------------------------------------------------------------

vi.mock('@/lib/api/todos', () => ({
  listTodos: vi.fn(),
  createTodo: vi.fn(),
  updateTodo: vi.fn(),
  moveTodo: vi.fn(),
  deleteTodo: vi.fn(),
  uploadAttachment: vi.fn(),
}));

// Identity + session spawn are out of scope here.
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: 'proj-1', chatId: null }),
}));
vi.mock('../use-start-todo-session', () => ({
  useStartTodoSession: () => vi.fn(),
}));

// Heavy list/board views are irrelevant — assert on the board header chip.
vi.mock('../TaskListView', () => ({
  TaskListView: () => <div data-testid="task-list-view-stub" />,
}));
vi.mock('../TaskBoardView', () => ({
  TaskBoardView: () => <div data-testid="task-board-view-stub" />,
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { TasksModalHost } from '../TasksModalHost';
import { useTasksModal } from '../use-tasks-modal';
import { useTodosStore } from '../use-todos-store';
import * as todosApi from '@/lib/api/todos';
import type { Todo } from '@/lib/api/todos';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PORT = 31415;

function makeTodo(overrides: Partial<Todo> & { id: string; number: number }): Todo {
  return {
    project_id: 'proj-1',
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

const OPEN_TODO = makeTodo({ id: 'todo-1', number: 1, status: 'open' });
const DONE_TODO = makeTodo({ id: 'todo-1', number: 1, status: 'done' });

// ---------------------------------------------------------------------------
// Reset stores + mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  act(() => {
    useTasksModal.setState({ open: false, quickOpen: false });
    useTodosStore.setState({ todos: [], loading: false, error: null, loadedProjectId: null });
  });
});

// ---------------------------------------------------------------------------
// 1. Opening the modal refetches + renders fresh statuses
// ---------------------------------------------------------------------------

describe('TasksModalHost — refetch on modal open (todo #225)', () => {
  it('refetches and renders fresh statuses when the modal opens after an external change', async () => {
    vi.mocked(todosApi.listTodos)
      .mockResolvedValueOnce([OPEN_TODO]) // boot load
      .mockResolvedValueOnce([DONE_TODO]); // external change picked up on open

    render(<TasksModalHost port={PORT} />);

    // Boot load fires once so the inspector drawer has data.
    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledTimes(1));

    act(() => {
      useTasksModal.getState().openModal();
    });

    // Opening the modal issues a fresh listTodos call…
    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledTimes(2));
    // …and the board reflects the refetched (done) status.
    expect(await screen.findByText('0 active · 1 done')).toBeTruthy();
  });

  it('refetches again on every re-open (rising edge, not once)', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValue([OPEN_TODO]);

    render(<TasksModalHost port={PORT} />);
    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledTimes(1));

    act(() => useTasksModal.getState().openModal());
    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledTimes(2));

    act(() => useTasksModal.getState().closeModal());
    act(() => useTasksModal.getState().openModal());
    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledTimes(3));
  });
});

// ---------------------------------------------------------------------------
// 2. Opening the quick-add dialog refetches
// ---------------------------------------------------------------------------

describe('TasksModalHost — refetch on quick-add open', () => {
  it('refetches when the quick-add dialog opens', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValue([OPEN_TODO]);

    render(<TasksModalHost port={PORT} />);
    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledTimes(1));

    act(() => useTasksModal.getState().openQuick());
    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledTimes(2));
  });
});
