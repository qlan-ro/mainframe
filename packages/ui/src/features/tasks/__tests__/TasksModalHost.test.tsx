/**
 * TasksModalHost.test.tsx
 *
 * The Kanban/List board moved to the body (`TasksSurface`, D1/D7) — this
 * host is down to the ONE task edit modal and the quick-add dialog.
 *
 * Behaviors covered:
 *  1. Opening the quick-add dialog loads its own scoped project.
 *  2. Nothing loads while the quick-add dialog is closed.
 *  3. The host reloads its own project list on the rising edge of quick-add
 *     (todo #326 review finding 2 — carried over from the board's version).
 *  4. The quick-add dialog seeds from the sidebar filter, not the active
 *     session, when the two differ.
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
// every scope null and the dialog on its picker.
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

// ---------------------------------------------------------------------------
// Reset stores + mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // The filter is persisted and the store is a module singleton — an id left
  // over from a previous case would decide the seed.
  localStorage.clear();
  act(() => {
    useTasksModal.setState({ quickOpen: false });
    useSessionFilters.setState({ filterProjectIds: new Set() });
    useTodosStore.setState({ entries: {} });
  });
});

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
  it('fetches nothing while quick-add is closed', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValue([OPEN_TODO]);

    render(<TasksModalHost port={PORT} />);

    await waitFor(() => expect(screen.queryByTestId('tasks-quick-dialog')).toBeNull());
    expect(todosApi.listTodos).not.toHaveBeenCalled();
  });
});

describe('TasksModalHost — a project added after boot', () => {
  it('reloads this host’s own project list on the rising edge of quick-add', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValue([]);

    render(<TasksModalHost port={PORT} />);
    expect(RELOAD_PROJECTS).not.toHaveBeenCalled();

    act(() => useTasksModal.getState().openQuick());
    await waitFor(() => expect(RELOAD_PROJECTS).toHaveBeenCalled());
  });
});

describe('TasksModalHost — seeding', () => {
  it('opens on the sidebar filter, not on the active session, when the two differ', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValue([]);
    act(() => useSessionFilters.setState({ filterProjectIds: new Set(['proj-2']) }));

    render(<TasksModalHost port={PORT} />);
    act(() => useTasksModal.getState().openQuick());

    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledWith(PORT, 'proj-2'));
    expect(screen.getByTestId('tasks-quick-project')).toHaveTextContent('Sidecar');
  });
});
