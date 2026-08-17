/**
 * QuickTaskDialog.scope.test.tsx
 *
 * Behavior coverage for todo #326's quick-add acceptance criteria, driven
 * through the real TasksModalHost + useSessionFilters + useModalProjectScope.
 * QuickTaskDialog.test.tsx already covers the dialog's own props contract in
 * isolation; this file covers the ⌘⇧T path end to end.
 *
 * Behaviors covered:
 *  1. ⌘⇧T always produces a dialog: scoped and naming its project when one
 *     resolves (AC12).
 *  2. ⌘⇧T with no project resolvable renders the pick list instead of a dead
 *     click (AC12).
 *  3. Quick-add's scope is independent of an open board's in-modal override
 *     (spec decision 11): overriding the board's pick does not retarget a
 *     later quick-add open, which still seeds from the sidebar filter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
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

// The chord resolves `mod` per platform; jsdom reports non-Mac, so pin macOS
// to keep this suite's ⌘⇧T press meaningful.
vi.mock('@/features/shortcuts/platform', () => ({ isMacPlatform: () => true }));

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
import { useShortcutDispatcher } from '@/features/shortcuts/use-shortcut-dispatcher';
import { useTasksModal } from '../use-tasks-modal';
import { useTodosStore } from '../use-todos-store';
import { useSessionFilters } from '@/store/session-filters';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import * as todosApi from '@/lib/api/todos';

const PORT = 31415;

function identity(projectId: string | undefined): ReturnType<typeof useActiveIdentity> {
  return { projectName: 'Mainframe', projectId, isWorktree: false };
}

function pressQuickAddShortcut() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', key: 'T', metaKey: true, shiftKey: true }));
  });
}

/**
 * ⌘⇧T reaches the host through the shortcut registry now, so the dispatcher
 * has to be mounted alongside it — the host only registers the action.
 */
function Harness() {
  useShortcutDispatcher();
  return <TasksModalHost port={PORT} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(todosApi.listTodos).mockResolvedValue([]);
  vi.mocked(useActiveIdentity).mockReturnValue(identity('proj-1'));
  localStorage.clear();
  act(() => {
    useTasksModal.setState({ open: false, quickOpen: false });
    useSessionFilters.setState({ filterProjectId: null });
    useTodosStore.setState({ entries: {} });
  });
});

async function openPicker(testId: string) {
  const trigger = screen.getByTestId(testId);
  await act(async () => {
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    trigger.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
  });
}

// ---------------------------------------------------------------------------
// 1. Scoped open — always a dialog, named
// ---------------------------------------------------------------------------

describe('QuickTaskDialog — ⌘⇧T with a project resolvable', () => {
  it('opens the dialog and names the scoped project', async () => {
    act(() => useSessionFilters.setState({ filterProjectId: 'proj-2' }));

    render(<Harness />);
    pressQuickAddShortcut();

    expect(await screen.findByTestId('tasks-quick-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-quick-project')).toHaveTextContent('Sidecar');
    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledWith(PORT, 'proj-2'));
  });
});

// ---------------------------------------------------------------------------
// 2. Unscoped open — the pick list, never a dead click
// ---------------------------------------------------------------------------

describe('QuickTaskDialog — ⌘⇧T with no project resolvable', () => {
  it('renders the pick list instead of nothing', async () => {
    vi.mocked(useActiveIdentity).mockReturnValue(identity(undefined));

    render(<Harness />);
    pressQuickAddShortcut();

    expect(await screen.findByTestId('tasks-quick-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-quick-project-pick')).toBeInTheDocument();
    expect(screen.queryByTestId('tasks-quick-project')).toBeNull();
    expect(todosApi.listTodos).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Independence from an open board's in-modal override
// ---------------------------------------------------------------------------

describe('QuickTaskDialog — independence from the board’s scope (spec decision 11)', () => {
  it('is unaffected by an override made in the board, and seeds from the filter on its own open', async () => {
    const user = userEvent.setup();
    act(() => useSessionFilters.setState({ filterProjectId: 'proj-2' }));

    render(<Harness />);
    act(() => useTasksModal.getState().openModal());
    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledWith(PORT, 'proj-2'));
    expect(screen.getByTestId('tasks-board-project-picker')).toHaveTextContent('Sidecar');

    // Override the board's pick to proj-1 — a purely local, in-modal change.
    await openPicker('tasks-board-project-picker');
    await user.click(await screen.findByTestId('tasks-board-project-proj-1'));
    await waitFor(() => expect(screen.getByTestId('tasks-board-project-picker')).toHaveTextContent('Mainframe'));

    // Quick-add opens alongside the board, still on the sidebar filter's project.
    pressQuickAddShortcut();

    expect(await screen.findByTestId('tasks-quick-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-quick-project')).toHaveTextContent('Sidecar');
  });
});
