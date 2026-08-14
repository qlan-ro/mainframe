/**
 * TasksModalHost.test.tsx
 *
 * Regression coverage for todo #225 — the Tasks modal showed boot-time todos
 * forever because opening it never refetched — carried onto the per-open scope
 * of todo #326: the host no longer loads on mount, so each open must issue its
 * own listTodos for the project that open resolved to.
 *
 * These tests exercise the real useTodosStore + useTasksModal +
 * useModalProjectScope against a mocked lib/api/todos.
 *
 * Behaviors covered:
 *  1.  Opening the full modal loads the scoped project and renders fresh statuses.
 *  2.  Closing and re-opening loads again (rising edge, not once).
 *  3.  Opening the quick-add dialog loads its own scoped project.
 *  4.  Nothing loads while both dialogs are closed.
 *  5.  The sidebar filter wins over the active session when both resolve.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks BEFORE importing the store-backed component
// ---------------------------------------------------------------------------

const { PROJECTS, RELOAD_PROJECTS } = vi.hoisted(() => ({
  PROJECTS: [
    { id: 'proj-1', name: 'Mainframe', path: '/repos/mainframe' },
    { id: 'proj-2', name: 'Sidecar', path: '/repos/sidecar' },
  ],
  // Shared, not a fresh `vi.fn()` per `useProjects()` call, so a test can
  // assert it fired — this host owns its own instance on top of the one
  // `useModalProjectScope` reloads internally, so both call it.
  RELOAD_PROJECTS: vi.fn(),
}));

vi.mock('@/lib/api/todos', () => ({
  listTodos: vi.fn(),
  createTodo: vi.fn(),
  updateTodo: vi.fn(),
  moveTodo: vi.fn(),
  deleteTodo: vi.fn(),
  uploadAttachment: vi.fn(),
}));

// The seeding rule validates the active session's project against this list, so
// an unmocked useProjects (which also needs a DaemonPortProvider) would leave
// every scope null and every dialog on its picker.
vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({
    projects: PROJECTS,
    loading: false,
    reloadProjects: RELOAD_PROJECTS,
    removeProjectFromList: vi.fn(),
  }),
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
import { useSessionFilters } from '@/store/session-filters';
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
  // The filter is persisted and the store is a module singleton — an id left
  // over from a previous case would decide the seed.
  localStorage.clear();
  act(() => {
    useTasksModal.setState({ open: false, quickOpen: false });
    useSessionFilters.setState({ filterProjectId: null });
    useTodosStore.setState({ entries: {} });
  });
});

// ---------------------------------------------------------------------------
// 1-2. Opening the modal loads its scope, every time
// ---------------------------------------------------------------------------

describe('TasksModalHost — the board loads its scope on open (todo #225)', () => {
  it('loads on open and renders the fetched statuses', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValue([DONE_TODO]);

    render(<TasksModalHost port={PORT} />);

    act(() => {
      useTasksModal.getState().openModal();
    });

    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledWith(PORT, 'proj-1'));
    expect(await screen.findByText('0 active · 1 done')).toBeTruthy();
  });

  it('loads again on every re-open (rising edge, not once)', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValue([OPEN_TODO]);

    render(<TasksModalHost port={PORT} />);

    act(() => useTasksModal.getState().openModal());
    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledTimes(1));

    act(() => useTasksModal.getState().closeModal());
    act(() => useTasksModal.getState().openModal());
    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledTimes(2));
  });
});

// ---------------------------------------------------------------------------
// 3-4. Quick-add carries its own scope; a closed host fetches nothing
// ---------------------------------------------------------------------------

describe('TasksModalHost — quick-add', () => {
  it('loads its own scoped project when it opens', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValue([OPEN_TODO]);

    render(<TasksModalHost port={PORT} />);

    act(() => useTasksModal.getState().openQuick());

    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledWith(PORT, 'proj-1'));
    expect(screen.getByTestId('tasks-quick-project')).toHaveTextContent('Mainframe');
  });
});

describe('TasksModalHost — closed', () => {
  it('fetches nothing while both dialogs are closed', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValue([OPEN_TODO]);

    render(<TasksModalHost port={PORT} />);

    await waitFor(() => expect(screen.queryByTestId('tasks-board-modal')).toBeNull());
    expect(todosApi.listTodos).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The host's own project list is stale after boot — a project added
// mid-session must not stay permanently unreachable (todo #326 review finding 2)
// ---------------------------------------------------------------------------

describe('TasksModalHost — a project added after boot', () => {
  it('reloads this host’s own project list on the rising edge of either dialog', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValue([]);

    render(<TasksModalHost port={PORT} />);
    expect(RELOAD_PROJECTS).not.toHaveBeenCalled();

    act(() => useTasksModal.getState().openModal());
    await waitFor(() => expect(RELOAD_PROJECTS).toHaveBeenCalled());

    RELOAD_PROJECTS.mockClear();
    act(() => useTasksModal.getState().closeModal());
    act(() => useTasksModal.getState().openQuick());
    await waitFor(() => expect(RELOAD_PROJECTS).toHaveBeenCalled());
  });
});

// ---------------------------------------------------------------------------
// 5. The seed comes from the sidebar filter first
// ---------------------------------------------------------------------------

describe('TasksModalHost — seeding', () => {
  it('opens on the sidebar filter, not on the active session, when the two differ', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValue([]);
    act(() => useSessionFilters.setState({ filterProjectId: 'proj-2' }));

    render(<TasksModalHost port={PORT} />);
    act(() => useTasksModal.getState().openModal());

    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledWith(PORT, 'proj-2'));
    expect(screen.getByTestId('tasks-board-project-picker')).toHaveTextContent('Sidecar');
  });
});
