/**
 * TasksBoard.test.tsx
 *
 * Behaviors covered:
 *  1.  Renders data-testid="tasks-board-modal".
 *  2.  Renders a close button (tasks-board-close) as the header's first
 *      interactive element, to the left of the "Tasks" title (finding 9.1).
 *  3.  Clicking the close button calls the onClose prop.
 *  4.  Renders tasks-view-list / tasks-view-board segmented switch.
 *  5.  Renders tasks-board-new button.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mock useTodosStore
// ---------------------------------------------------------------------------

const mockSetView = vi.fn();
const mockSetSort = vi.fn();
const mockSetFilters = vi.fn();
let mockTodos: import('@/lib/api/todos').Todo[] = [];
let mockLoading = false;

vi.mock('../use-todos-store', () => ({
  useTodosStore: vi.fn(() => ({
    todos: mockTodos,
    loading: mockLoading,
    filters: { types: [], priorities: [], labels: [], search: '' },
    sort: { key: 'priority', dir: 'asc' },
    view: 'list',
    move: vi.fn(),
    remove: vi.fn(),
    setFilters: mockSetFilters,
    setSort: mockSetSort,
    setView: mockSetView,
  })),
}));

// Stub the heavy child views — this file exercises TasksBoard's own header only.
vi.mock('../TaskListView', () => ({
  TaskListView: () => <div data-testid="task-list-view-stub" />,
}));
vi.mock('../TaskBoardView', () => ({
  TaskBoardView: () => <div data-testid="task-board-view-stub" />,
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { TasksBoard } from '../TasksBoard';
import type { Todo } from '@/lib/api/todos';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderBoard(onClose = vi.fn()) {
  render(<TasksBoard port={31415} projectId="proj-1" onStartSession={vi.fn()} onClose={onClose} />);
  return { onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTodos = [];
  mockLoading = false;
});

describe('TasksBoard — root testid', () => {
  it('renders tasks-board-modal', () => {
    renderBoard();
    expect(screen.getByTestId('tasks-board-modal')).toBeTruthy();
  });
});

describe('TasksBoard — close button (finding 9.1)', () => {
  it('renders tasks-board-close', () => {
    renderBoard();
    expect(screen.getByTestId('tasks-board-close')).toBeTruthy();
  });

  it('positions the close button before the "Tasks" title in DOM order', () => {
    renderBoard();
    const header = screen.getByTestId('tasks-board-modal').firstElementChild as HTMLElement;
    const closeBtn = screen.getByTestId('tasks-board-close');
    const title = screen.getByText('Tasks');
    const children = Array.from(header.querySelectorAll('*'));
    expect(children.indexOf(closeBtn)).toBeLessThan(children.indexOf(title));
  });

  it('calls onClose when clicked', async () => {
    const { onClose } = renderBoard();
    await userEvent.click(screen.getByTestId('tasks-board-close'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('TasksBoard — segmented view switch + new button still render', () => {
  it('renders tasks-view-list, tasks-view-board, tasks-board-new', () => {
    renderBoard();
    expect(screen.getByTestId('tasks-view-list')).toBeTruthy();
    expect(screen.getByTestId('tasks-view-board')).toBeTruthy();
    expect(screen.getByTestId('tasks-board-new')).toBeTruthy();
  });
});

describe('TasksBoard — loading does not blank the board on refetch (todo #225)', () => {
  it('shows the loading placeholder only on the first load (no todos yet)', () => {
    mockLoading = true;
    mockTodos = [];
    renderBoard();
    expect(screen.getByTestId('tasks-board-loading')).toBeTruthy();
    expect(screen.queryByTestId('task-list-view-stub')).toBeNull();
  });

  it('keeps the previous list rendered while a refetch is in flight (todos present)', () => {
    mockLoading = true;
    mockTodos = [makeTodo({ id: 'todo-1', number: 1, status: 'open' })];
    renderBoard();
    expect(screen.queryByTestId('tasks-board-loading')).toBeNull();
    expect(screen.getByTestId('task-list-view-stub')).toBeTruthy();
  });
});
