/**
 * TasksBoard.multi.test.tsx — multi-project behaviors.
 *
 * Unlike TasksBoard.test.tsx (which stubs TaskListView/TaskBoardView to
 * exercise the header in isolation), this file renders the real list view so
 * it can assert on what actually reaches the DOM: merged todos, per-row
 * project avatars, the GitHub control's visibility, and that a mutation
 * triggered from a merged board acts on the ROW's own project, not some
 * single board-level project that no longer exists.
 *
 * Behaviors covered:
 *  1. A multi-project scope merges every project's todos.
 *  2. A multi-project scope shows each row's project avatar; a single-project
 *     scope shows none.
 *  3. The GitHub control renders only for a single-project scope.
 *  4. Deleting a row in a merged board calls `remove` with THAT row's own
 *     project id, not another project's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Todo } from '@/lib/api/todos';

const mockRemove = vi.fn();
const mockMove = vi.fn();
const mockLoad = vi.fn();
let mockTodos: Todo[] = [];

vi.mock('../use-todos-store', () => ({
  useTodosStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      entries: {},
      load: mockLoad,
      filters: { types: [], priorities: [], labels: [], search: '' },
      sort: { key: 'priority', dir: 'asc' },
      view: 'list',
      move: mockMove,
      remove: mockRemove,
      setFilters: vi.fn(),
      setSort: vi.fn(),
      setView: vi.fn(),
    };
    return selector ? selector(state) : state;
  }),
  useMergedTodos: () => ({ todos: mockTodos, loading: false, error: null }),
  selectProjectTodos: () => () => ({ todos: [], loading: false, error: null }),
}));

const PROJECTS = [
  { id: 'proj-1', name: 'Mainframe', path: '/repos/mainframe' },
  { id: 'proj-2', name: 'Sidecar', path: '/repos/sidecar' },
];

vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({ projects: PROJECTS, loading: false, reloadProjects: vi.fn(), removeProjectFromList: vi.fn() }),
}));

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: null }),
}));

import { TasksBoard } from '../TasksBoard';

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

const TODO_A = makeTodo({ id: 'todo-a', number: 1, project_id: 'proj-1', title: 'Todo A' });
const TODO_B = makeTodo({ id: 'todo-b', number: 2, project_id: 'proj-2', title: 'Todo B' });

function renderBoard(projectIds: string[]) {
  render(
    <TooltipProvider>
      <TasksBoard port={31415} projectIds={projectIds} onStartSession={vi.fn()} />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTodos = [];
});

describe('TasksBoard — multi-project merge', () => {
  it('shows every project’s todos in one board', () => {
    mockTodos = [TODO_A, TODO_B];
    renderBoard(['proj-1', 'proj-2']);

    expect(screen.getByTestId('tasks-list-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-list-row-2')).toBeInTheDocument();
  });
});

describe('TasksBoard — per-row project avatars', () => {
  it('shows a project avatar on every row when more than one project is in scope', () => {
    mockTodos = [TODO_A, TODO_B];
    renderBoard(['proj-1', 'proj-2']);

    expect(screen.getByTestId('tasks-list-row-project-1')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-list-row-project-2')).toBeInTheDocument();
  });

  it('shows no project avatar when only one project is in scope', () => {
    mockTodos = [TODO_A];
    renderBoard(['proj-1']);

    expect(screen.queryByTestId('tasks-list-row-project-1')).toBeNull();
  });
});

describe('TasksBoard — GitHub control visibility', () => {
  it('renders the GitHub control for a single-project scope', () => {
    mockTodos = [TODO_A];
    renderBoard(['proj-1']);

    expect(screen.getByTestId('tasks-github-link')).toBeInTheDocument();
  });

  it('hides the GitHub control for a multi-project scope', () => {
    mockTodos = [TODO_A, TODO_B];
    renderBoard(['proj-1', 'proj-2']);

    expect(screen.queryByTestId('tasks-github-link')).toBeNull();
    expect(screen.queryByTestId('tasks-github-pill')).toBeNull();
  });
});

describe('TasksBoard — mutations act on the row’s own project', () => {
  it('deletes using the todo’s own project id, not the other project in the merged board', async () => {
    mockTodos = [TODO_A, TODO_B];
    renderBoard(['proj-1', 'proj-2']);

    await userEvent.click(screen.getByTestId('tasks-list-row-delete-2'));

    expect(mockRemove).toHaveBeenCalledWith(31415, 'todo-b', 'proj-2');
    expect(mockRemove).not.toHaveBeenCalledWith(31415, 'todo-b', 'proj-1');
  });
});
