/**
 * TasksSidebarList — unit tests.
 *
 * D22: Header "Tasks" + Open board + quick-add. Scope: the session scope's
 * sole project; with none, a picker row chooses one for this run (not
 * persisted). Groups In progress / Open / Done (Done collapsed by default).
 * A row cycles through `useTodosStore.move` and opens the shared edit modal
 * through `useTasksModal.openEdit`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Todo } from '@/lib/api/todos';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useSessionFilters } from '@/store/session-filters';
import { useTasksModal } from '../../use-tasks-modal';
import { useTodosStore } from '../../use-todos-store';
import { useTasksSidebarScope } from '../use-tasks-sidebar-scope';

vi.mock('@/lib/api/todos', () => ({
  listTodos: vi.fn(),
  createTodo: vi.fn(),
  updateTodo: vi.fn(),
  moveTodo: vi.fn(),
  deleteTodo: vi.fn(),
  uploadAttachment: vi.fn(),
}));

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));

let mockProjects: { id: string; name: string }[] = [
  { id: 'proj-1', name: 'Mainframe' },
  { id: 'proj-2', name: 'Sidecar' },
];
vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({ projects: mockProjects, loading: false, reloadProjects: vi.fn() }),
}));

const startTodoSession = vi.fn();
vi.mock('../../use-start-todo-session', () => ({
  useStartTodoSession: () => startTodoSession,
}));

const { TasksSidebarList } = await import('../TasksSidebarList');
const todosApi = await import('@/lib/api/todos');

function makeTodo(over: Partial<Todo> & { id: string; number: number }): Todo {
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
    ...over,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}
const render_ = () => render(<TasksSidebarList />, { wrapper: Wrapper });

beforeEach(() => {
  vi.clearAllMocks();
  mockProjects = [
    { id: 'proj-1', name: 'Mainframe' },
    { id: 'proj-2', name: 'Sidecar' },
  ];
  vi.mocked(todosApi.listTodos).mockResolvedValue([]);
  useSessionFilters.setState({ filterProjectIds: new Set() });
  useTasksSidebarScope.setState({ projectId: null });
  useTasksModal.setState({ open: false, quickOpen: false, edit: null });
  useTodosStore.setState({ entries: {} });
});

describe('TasksSidebarList — no sole project in scope', () => {
  it('shows the project picker and a "pick a project" placeholder, loading nothing', () => {
    render_();
    expect(screen.getByTestId('tasks-sidebar-project-picker')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-sidebar-no-project')).toBeInTheDocument();
    expect(todosApi.listTodos).not.toHaveBeenCalled();
  });

  it('loads that project’s tasks once picked, without persisting it to the session scope', async () => {
    render_();
    fireEvent.pointerDown(screen.getByTestId('tasks-sidebar-project-picker'), { button: 0 });
    fireEvent.pointerUp(screen.getByTestId('tasks-sidebar-project-picker'));
    fireEvent.click(await screen.findByTestId('tasks-sidebar-project-proj-2'));

    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledWith(31415, 'proj-2'));
    expect(useTasksSidebarScope.getState().projectId).toBe('proj-2');
    expect(useSessionFilters.getState().filterProjectIds.size).toBe(0);
  });
});

describe('TasksSidebarList — a sole scoped project', () => {
  beforeEach(() => {
    useSessionFilters.setState({ filterProjectIds: new Set(['proj-1']) });
  });

  it('shows no picker, and loads that project’s tasks', async () => {
    render_();
    expect(screen.queryByTestId('tasks-sidebar-project-picker')).toBeNull();
    await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledWith(31415, 'proj-1'));
  });

  it('groups rows into In progress / Open / Done, with Done collapsed by default', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValue([
      makeTodo({ id: 't-1', number: 1, status: 'open', title: 'Open task' }),
      makeTodo({ id: 't-2', number: 2, status: 'in_progress', title: 'In progress task' }),
      makeTodo({ id: 't-3', number: 3, status: 'done', title: 'Done task' }),
    ]);
    render_();

    await screen.findByTestId('tasks-sidebar-row-1');
    expect(screen.getByTestId('tasks-sidebar-row-2')).toBeInTheDocument();
    expect(screen.queryByTestId('tasks-sidebar-row-3')).toBeNull();
    expect(screen.getByTestId('tasks-sidebar-group-toggle-Done')).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByTestId('tasks-sidebar-group-toggle-Done'));
    expect(screen.getByTestId('tasks-sidebar-row-3')).toBeInTheDocument();
  });

  it('cycles a row’s status through useTodosStore.move', async () => {
    const base = makeTodo({ id: 't-1', number: 1, status: 'open' });
    vi.mocked(todosApi.listTodos).mockResolvedValue([base]);
    vi.mocked(todosApi.moveTodo).mockResolvedValue({ ...base, status: 'in_progress' });
    render_();

    await screen.findByTestId('tasks-sidebar-row-1');
    fireEvent.click(screen.getByTestId('tasks-sidebar-cycle-1'));

    await waitFor(() => expect(todosApi.moveTodo).toHaveBeenCalledWith(31415, 't-1', 'in_progress'));
  });

  it('opens the shared edit modal on a row click, scoped to the project and todo', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValue([makeTodo({ id: 't-1', number: 1 })]);
    render_();

    await screen.findByTestId('tasks-sidebar-row-1');
    fireEvent.click(screen.getByTestId('tasks-sidebar-row-1'));

    expect(useTasksModal.getState().edit).toEqual({ projectId: 'proj-1', todoId: 't-1' });
  });

  it('starts a session from the row’s Start action', async () => {
    vi.mocked(todosApi.listTodos).mockResolvedValue([makeTodo({ id: 't-1', number: 1, status: 'open' })]);
    render_();

    await screen.findByTestId('tasks-sidebar-row-1');
    fireEvent.click(screen.getByTestId('tasks-sidebar-start-1'));

    expect(startTodoSession).toHaveBeenCalledWith('t-1', 'open');
  });

  it('opens the full board from "Open board"', () => {
    render_();
    fireEvent.click(screen.getByTestId('tasks-sidebar-open-board'));
    expect(useTasksModal.getState().open).toBe(true);
  });
});
