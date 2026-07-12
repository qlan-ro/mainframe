/**
 * TasksDrawer.test.tsx
 *
 * Behaviors covered:
 *  1.  Renders data-testid="tasks-drawer".
 *  2.  Renders data-testid="tasks-drawer-new" (New button).
 *  3.  Renders data-testid="tasks-drawer-expand" (Expand button).
 *  4.  TasksDrawerList rows are rendered for non-done todos (tasks-drawer-row-<number>).
 *  5.  Clicking Expand calls useTasksModal.openModal.
 *  6.  Clicking New opens the TaskEditModal (a create modal appears).
 *  7.  Done todos do NOT appear as drawer rows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mock useTasksModal — capture openModal calls
// ---------------------------------------------------------------------------

const mockOpenModal = vi.fn();

vi.mock('../use-tasks-modal', () => ({
  useTasksModal: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = { openModal: mockOpenModal, open: false, quickOpen: false };
    return selector ? selector(state) : state;
  }),
}));

// ---------------------------------------------------------------------------
// Mock useTodosStore — control the todos list and load
// ---------------------------------------------------------------------------

const mockLoad = vi.fn().mockResolvedValue(undefined);
let mockTodos: import('@/lib/api/todos').Todo[] = [];

vi.mock('../use-todos-store', () => ({
  useTodosStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      todos: mockTodos,
      loading: false,
      error: null,
      load: mockLoad,
      create: vi.fn().mockResolvedValue({ id: 'new' }),
      update: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    return selector ? selector(state) : state;
  }),
}));

// Mock TaskAttachments used inside TaskEditModal
vi.mock('../TaskAttachments', () => ({
  TaskAttachments: () => <div data-testid="tasks-attach-stub" />,
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { TasksDrawer } from '../TasksDrawer';
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

const OPEN_TODO = makeTodo({ id: 'todo-1', number: 1, title: 'Open task', status: 'open' });
const IN_PROGRESS_TODO = makeTodo({ id: 'todo-2', number: 2, title: 'In progress task', status: 'in_progress' });
const DONE_TODO = makeTodo({ id: 'todo-3', number: 3, title: 'Done task', status: 'done' });

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderDrawer(todos: Todo[] = []) {
  mockTodos = todos;
  render(<TasksDrawer port={31415} projectId="proj-1" />);
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockTodos = [];
  mockLoad.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// 1–3. Key testids rendered
// ---------------------------------------------------------------------------

describe('TasksDrawer — key testids are rendered', () => {
  it('renders tasks-drawer', () => {
    renderDrawer();
    expect(screen.getByTestId('tasks-drawer')).toBeTruthy();
  });

  it('renders the "Tasks" header label as a sentence-case muted eyebrow (no uppercase/tracking)', () => {
    renderDrawer();
    const label = screen.getByTestId('tasks-drawer-label');
    expect(label.textContent).toBe('Tasks');
    expect(label.className).toContain('text-muted-foreground');
    expect(label.className).not.toContain('uppercase');
    expect(label.className).not.toContain('tracking-wide');
  });

  it('renders the active-count badge (tasks-drawer-count) as capsule-less muted numerals', () => {
    renderDrawer([OPEN_TODO]);
    const badge = screen.getByTestId('tasks-drawer-count');
    expect(badge.textContent).toBe('1');
    expect(badge.className).toContain('tabular-nums');
    expect(badge.className).toContain('text-muted-foreground');
    expect(badge.className).not.toContain('bg-mf-chip');
  });

  it('does NOT render the count badge when there are zero active todos', () => {
    renderDrawer([DONE_TODO]);
    expect(screen.queryByTestId('tasks-drawer-count')).toBeNull();
  });

  it('renders tasks-drawer-new (New button)', () => {
    renderDrawer();
    expect(screen.getByTestId('tasks-drawer-new')).toBeTruthy();
  });

  it('renders tasks-drawer-expand (Expand button)', () => {
    renderDrawer();
    expect(screen.getByTestId('tasks-drawer-expand')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 4. Rows rendered for non-done todos
// ---------------------------------------------------------------------------

describe('TasksDrawer — renders rows for active (non-done) todos', () => {
  it('renders tasks-drawer-row-1 for an open todo with number 1', () => {
    renderDrawer([OPEN_TODO]);
    expect(screen.getByTestId('tasks-drawer-row-1')).toBeTruthy();
  });

  it('renders tasks-drawer-row-2 for an in_progress todo with number 2', () => {
    renderDrawer([IN_PROGRESS_TODO]);
    expect(screen.getByTestId('tasks-drawer-row-2')).toBeTruthy();
  });

  it('renders rows for both open and in_progress todos', () => {
    renderDrawer([OPEN_TODO, IN_PROGRESS_TODO]);
    expect(screen.getByTestId('tasks-drawer-row-1')).toBeTruthy();
    expect(screen.getByTestId('tasks-drawer-row-2')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 5. Clicking Expand calls openModal
// ---------------------------------------------------------------------------

describe('TasksDrawer — Expand button calls useTasksModal.openModal', () => {
  it('calls openModal exactly once when Expand is clicked', async () => {
    renderDrawer();

    await userEvent.click(screen.getByTestId('tasks-drawer-expand'));

    expect(mockOpenModal).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 6. Clicking New opens the TaskEditModal
// ---------------------------------------------------------------------------

describe('TasksDrawer — New button opens the create modal', () => {
  it('renders tasks-edit-title (modal title input) after clicking New', async () => {
    renderDrawer();

    await userEvent.click(screen.getByTestId('tasks-drawer-new'));

    await waitFor(() => {
      expect(screen.getByTestId('tasks-edit-title')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Done todos do NOT appear as drawer rows
// ---------------------------------------------------------------------------

describe('TasksDrawer — done todos are excluded from drawer rows', () => {
  it('does NOT render tasks-drawer-row-3 for a done todo', () => {
    renderDrawer([DONE_TODO]);
    expect(screen.queryByTestId('tasks-drawer-row-3')).toBeNull();
  });

  it('renders only the active rows when a mix of done and open todos is provided', () => {
    renderDrawer([OPEN_TODO, DONE_TODO]);
    expect(screen.getByTestId('tasks-drawer-row-1')).toBeTruthy();
    expect(screen.queryByTestId('tasks-drawer-row-3')).toBeNull();
  });
});
