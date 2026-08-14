/**
 * TasksModalHost.scope.test.tsx
 *
 * Behavior coverage for todo #326's Kanban acceptance criteria, driven
 * end-to-end through the real useSessionFilters, useModalProjectScope and
 * useTodosStore with @/lib/api/todos mocked. TasksModalHost.test.tsx already
 * covers the load-on-open contract (#225); this file covers the per-open
 * project scope on top of it, so views are NOT stubbed here — AC4 needs real
 * rendered rows to prove the previous project's todos are gone.
 *
 * Behaviors covered:
 *  1. Session in A, filter on B: opens the board on B and names B (AC1).
 *  2. The in-modal picker re-scopes the list; no A row survives (AC3, AC4).
 *  3. Picking inside the modal never writes the sidebar filter (AC5).
 *  4. A background filter/identity change while open is ignored; the next
 *     open takes the new seed (AC8).
 *  5. Close-and-reopen after an in-modal override returns to the filter's
 *     project, not the override (AC7).
 *  6. Create/move/delete issue their calls against the scoped project (AC9).
 *  7. No session, a projectless draft, filter unset: Kanban still renders a
 *     surface — the pick list, never nothing (AC11).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks BEFORE importing the store-backed component
// ---------------------------------------------------------------------------

const { PROJECTS } = vi.hoisted(() => ({
  PROJECTS: [
    { id: 'proj-1', name: 'Mainframe', path: '/repos/mainframe' },
    { id: 'proj-2', name: 'Sidecar', path: '/repos/sidecar' },
  ],
}));

vi.mock('@/lib/api/todos', () => ({
  listTodos: vi.fn(),
  createTodo: vi.fn(),
  updateTodo: vi.fn(),
  moveTodo: vi.fn(),
  deleteTodo: vi.fn(),
  uploadAttachment: vi.fn(),
}));

vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({
    projects: PROJECTS,
    loading: false,
    reloadProjects: vi.fn(),
    removeProjectFromList: vi.fn(),
  }),
}));

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: vi.fn(() => ({ projectId: 'proj-1', chatId: null })),
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
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import * as todosApi from '@/lib/api/todos';
import type { Todo } from '@/lib/api/todos';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PORT = 31415;

function makeTodo(overrides: Partial<Todo> & { id: string; number: number; project_id: string }): Todo {
  return {
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

const A_TODO = makeTodo({ id: 'todo-a', number: 1, project_id: 'proj-1', title: 'A task' });
const B_TODO = makeTodo({ id: 'todo-b', number: 2, project_id: 'proj-2', title: 'B task' });

function byProject(projectId: string): Todo[] {
  if (projectId === 'proj-1') return [A_TODO];
  if (projectId === 'proj-2') return [B_TODO];
  return [];
}

function identity(projectId: string | undefined): ReturnType<typeof useActiveIdentity> {
  return { projectName: 'Mainframe', projectId, isWorktree: false };
}

// ---------------------------------------------------------------------------
// Reset stores + mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(todosApi.listTodos).mockImplementation((_port, projectId) => Promise.resolve(byProject(projectId)));
  vi.mocked(useActiveIdentity).mockReturnValue(identity('proj-1'));
  localStorage.clear();
  act(() => {
    useTasksModal.setState({ open: false, quickOpen: false });
    useSessionFilters.setState({ filterProjectId: null });
    useTodosStore.setState({ entries: {} });
  });
});

// ---------------------------------------------------------------------------
// Radix DropdownMenu needs pointerdown+up before the click it opens on
// ---------------------------------------------------------------------------

async function openPicker(user: ReturnType<typeof userEvent.setup>, testId: string) {
  const trigger = screen.getByTestId(testId);
  await act(async () => {
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    trigger.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
  });
  void user;
}

// ---------------------------------------------------------------------------
// 1. AC1 — session in A, filter on B
// ---------------------------------------------------------------------------

describe('TasksModalHost — session in A, filter on B', () => {
  it('opens the board scoped to B and names B in the header', async () => {
    act(() => useSessionFilters.setState({ filterProjectId: 'proj-2' }));

    render(<TasksModalHost port={PORT} />);
    act(() => useTasksModal.getState().openModal());

    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledWith(PORT, 'proj-2'));
    expect(screen.getByTestId('tasks-board-project-picker')).toHaveTextContent('Sidecar');
    expect(await screen.findByText('B task')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2-3. AC3/AC4/AC5 — the in-modal picker re-scopes and never writes the filter
// ---------------------------------------------------------------------------

describe('TasksModalHost — the in-modal picker', () => {
  it('re-scopes the list, drops the previous project’s rows, and leaves the sidebar filter untouched', async () => {
    const user = userEvent.setup();
    act(() => useSessionFilters.setState({ filterProjectId: 'proj-2' }));

    render(<TasksModalHost port={PORT} />);
    act(() => useTasksModal.getState().openModal());
    expect(await screen.findByText('B task')).toBeInTheDocument();

    await openPicker(user, 'tasks-board-project-picker');
    await user.click(await screen.findByTestId('tasks-board-project-proj-1'));

    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledWith(PORT, 'proj-1'));
    expect(await screen.findByText('A task')).toBeInTheDocument();
    expect(screen.queryByText('B task')).toBeNull();
    expect(screen.getByTestId('tasks-board-project-picker')).toHaveTextContent('Mainframe');

    // AC5 — the sidebar filter never moves.
    expect(useSessionFilters.getState().filterProjectId).toBe('proj-2');
  });
});

// ---------------------------------------------------------------------------
// 4. AC8 — background filter/identity changes while open are ignored
// ---------------------------------------------------------------------------

describe('TasksModalHost — a background change while the modal is open', () => {
  it('leaves the open board unchanged, and the next open takes the new seed', async () => {
    act(() => useSessionFilters.setState({ filterProjectId: 'proj-2' }));

    render(<TasksModalHost port={PORT} />);
    act(() => useTasksModal.getState().openModal());
    expect(await screen.findByText('B task')).toBeInTheDocument();
    vi.mocked(todosApi.listTodos).mockClear();

    act(() => {
      useSessionFilters.setState({ filterProjectId: 'proj-1' });
      vi.mocked(useActiveIdentity).mockReturnValue(identity('proj-1'));
    });

    expect(screen.getByTestId('tasks-board-project-picker')).toHaveTextContent('Sidecar');
    expect(screen.getByText('B task')).toBeInTheDocument();
    expect(todosApi.listTodos).not.toHaveBeenCalled();

    act(() => useTasksModal.getState().closeModal());
    act(() => useTasksModal.getState().openModal());

    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledWith(PORT, 'proj-1'));
    expect(screen.getByTestId('tasks-board-project-picker')).toHaveTextContent('Mainframe');
  });
});

// ---------------------------------------------------------------------------
// 5. AC7 — close-and-reopen after an override returns to the filter's project
// ---------------------------------------------------------------------------

describe('TasksModalHost — close and reopen after an in-modal override', () => {
  it('discards the override and re-seeds from the sidebar filter', async () => {
    const user = userEvent.setup();
    act(() => useSessionFilters.setState({ filterProjectId: 'proj-2' }));

    render(<TasksModalHost port={PORT} />);
    act(() => useTasksModal.getState().openModal());
    expect(await screen.findByText('B task')).toBeInTheDocument();

    await openPicker(user, 'tasks-board-project-picker');
    await user.click(await screen.findByTestId('tasks-board-project-proj-1'));
    expect(await screen.findByText('A task')).toBeInTheDocument();

    act(() => useTasksModal.getState().closeModal());
    act(() => useTasksModal.getState().openModal());

    await waitFor(() => expect(screen.getByTestId('tasks-board-project-picker')).toHaveTextContent('Sidecar'));
    expect(await screen.findByText('B task')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 6. AC9 — create/move/delete carry the scoped project id
// ---------------------------------------------------------------------------

describe('TasksModalHost — mutations follow the scoped project', () => {
  it('create sends the scoped projectId', async () => {
    const user = userEvent.setup();
    vi.mocked(todosApi.createTodo).mockResolvedValue(makeTodo({ id: 'new', number: 3, project_id: 'proj-2' }));
    act(() => useSessionFilters.setState({ filterProjectId: 'proj-2' }));

    render(<TasksModalHost port={PORT} />);
    act(() => useTasksModal.getState().openModal());
    expect(await screen.findByText('B task')).toBeInTheDocument();

    await user.click(screen.getByTestId('tasks-board-new'));
    await user.type(screen.getByTestId('tasks-edit-title'), 'New from board');
    await user.click(screen.getByTestId('tasks-edit-save'));

    await waitFor(() => expect(todosApi.createTodo).toHaveBeenCalled());
    const [, input] = vi.mocked(todosApi.createTodo).mock.calls[0]!;
    expect((input as { projectId: string }).projectId).toBe('proj-2');
  });

  it('move (status cycle) refetches the scoped project', async () => {
    const user = userEvent.setup();
    vi.mocked(todosApi.moveTodo).mockResolvedValue(B_TODO);
    act(() => useSessionFilters.setState({ filterProjectId: 'proj-2' }));

    render(<TasksModalHost port={PORT} />);
    act(() => useTasksModal.getState().openModal());
    expect(await screen.findByText('B task')).toBeInTheDocument();
    vi.mocked(todosApi.listTodos).mockClear();

    await user.click(screen.getByTestId(`tasks-list-row-cycle-${B_TODO.number}`));

    await waitFor(() => expect(todosApi.moveTodo).toHaveBeenCalledWith(PORT, 'todo-b', 'in_progress'));
    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledWith(PORT, 'proj-2'));
  });

  it('delete refetches the scoped project', async () => {
    const user = userEvent.setup();
    vi.mocked(todosApi.deleteTodo).mockResolvedValue(undefined);
    act(() => useSessionFilters.setState({ filterProjectId: 'proj-2' }));

    render(<TasksModalHost port={PORT} />);
    act(() => useTasksModal.getState().openModal());
    expect(await screen.findByText('B task')).toBeInTheDocument();
    vi.mocked(todosApi.listTodos).mockClear();

    await user.click(screen.getByTestId(`tasks-list-row-delete-${B_TODO.number}`));

    await waitFor(() => expect(todosApi.deleteTodo).toHaveBeenCalledWith(PORT, 'todo-b'));
    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledWith(PORT, 'proj-2'));
  });
});

// ---------------------------------------------------------------------------
// 7. AC11 — no project resolvable: a surface renders, never nothing
// ---------------------------------------------------------------------------

describe('TasksModalHost — no session, a projectless draft, filter unset', () => {
  it('renders the pick-a-project state instead of a no-op', async () => {
    vi.mocked(useActiveIdentity).mockReturnValue(identity(undefined));

    render(<TasksModalHost port={PORT} />);
    act(() => useTasksModal.getState().openModal());

    expect(await screen.findByTestId('tasks-board-project-pick')).toBeInTheDocument();
    expect(screen.queryByTestId('tasks-board-modal')).toBeNull();
    expect(todosApi.listTodos).not.toHaveBeenCalled();

    const list = screen.getByTestId('tasks-board-project-pick');
    expect(within(list).getByTestId('tasks-board-project-proj-1')).toBeInTheDocument();
    expect(within(list).getByTestId('tasks-board-project-proj-2')).toBeInTheDocument();
  });
});
