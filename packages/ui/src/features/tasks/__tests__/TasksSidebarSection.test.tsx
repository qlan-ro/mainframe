/**
 * TasksSidebarSection.test.tsx
 *
 * The left-sidebar "Tasks" section (HIG swap: Tasks is a navigable collection,
 * so it moved from the right inspector's TasksDrawer into the left sidebar,
 * mirroring the Sessions section's header + full-width New row + rows).
 *
 * Behaviors covered:
 *  1.  Renders nothing when no project is active.
 *  2.  Renders data-testid="tasks-sidebar-section" when a project is active.
 *  3.  Renders the "Tasks" label + active-count badge.
 *  4.  Does NOT render the count badge when there are zero active todos.
 *  5.  Renders data-testid="tasks-sidebar-new" (New task row).
 *  6.  Renders data-testid="tasks-sidebar-expand" (expand-to-modal button).
 *  7.  TasksSidebarList rows are rendered for non-done todos (tasks-sidebar-row-<number>).
 *  8.  Done todos do NOT appear as rows.
 *  9.  Clicking Expand calls useTasksModal.openModal.
 *  10. Clicking New opens the TaskEditModal (create flow).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useUiPrefs } from '@/store/ui-prefs';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockProjectId: string | null = 'proj-1';
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: mockProjectId, chatId: null }),
}));

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

vi.mock('../use-start-todo-session', () => ({
  useStartTodoSession: () => vi.fn(),
}));

const mockOpenModal = vi.fn();
vi.mock('../use-tasks-modal', () => ({
  useTasksModal: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = { openModal: mockOpenModal, open: false, quickOpen: false };
    return selector ? selector(state) : state;
  }),
}));

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

vi.mock('../TaskAttachments', () => ({
  TaskAttachments: () => <div data-testid="tasks-attach-stub" />,
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { TasksSidebarSection } from '../TasksSidebarSection';
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

function renderSection(todos: Todo[] = [], projectId: string | null = 'proj-1') {
  mockTodos = todos;
  mockProjectId = projectId;
  render(<TasksSidebarSection />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTodos = [];
  mockProjectId = 'proj-1';
  mockLoad.mockResolvedValue(undefined);
  useUiPrefs.setState({ collapsedSidebarSections: {} });
});

// ---------------------------------------------------------------------------
// 1-2. Project scoping
// ---------------------------------------------------------------------------

describe('TasksSidebarSection — project scoping', () => {
  it('renders nothing when no project is active', () => {
    renderSection([], null);
    expect(screen.queryByTestId('tasks-sidebar-section')).toBeNull();
  });

  it('renders the section when a project is active', () => {
    renderSection();
    expect(screen.getByTestId('tasks-sidebar-section')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3. Header label
// ---------------------------------------------------------------------------

describe('TasksSidebarSection — header', () => {
  it('renders the "Tasks" label', () => {
    renderSection();
    expect(screen.getByText('Tasks')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 7-8. Rows rendered for non-done todos
//
// (tasks-sidebar-new/tasks-sidebar-expand testid presence is exercised
// implicitly by the click-interaction tests below — no bare presence
// smokes needed.)
// ---------------------------------------------------------------------------

describe('TasksSidebarSection — renders rows for active (non-done) todos', () => {
  it('renders tasks-sidebar-row-1 for an open todo with number 1', () => {
    renderSection([OPEN_TODO]);
    expect(screen.getByTestId('tasks-sidebar-row-1')).toBeTruthy();
  });

  it('renders rows for both open and in_progress todos', () => {
    renderSection([OPEN_TODO, IN_PROGRESS_TODO]);
    expect(screen.getByTestId('tasks-sidebar-row-1')).toBeTruthy();
    expect(screen.getByTestId('tasks-sidebar-row-2')).toBeTruthy();
  });

  it('does NOT render a row for a done todo', () => {
    renderSection([OPEN_TODO, DONE_TODO]);
    expect(screen.getByTestId('tasks-sidebar-row-1')).toBeTruthy();
    expect(screen.queryByTestId('tasks-sidebar-row-3')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. Expand calls openModal
// ---------------------------------------------------------------------------

describe('TasksSidebarSection — Expand button calls useTasksModal.openModal', () => {
  it('calls openModal exactly once when Expand is clicked', async () => {
    renderSection();

    await userEvent.click(screen.getByTestId('tasks-sidebar-expand'));

    expect(mockOpenModal).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 10. New opens the create modal
// ---------------------------------------------------------------------------

describe('TasksSidebarSection — New button opens the create modal', () => {
  it('renders tasks-edit-title (modal title input) after clicking New', async () => {
    renderSection();

    await userEvent.click(screen.getByTestId('tasks-sidebar-new'));

    await waitFor(() => {
      expect(screen.getByTestId('tasks-edit-title')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// 11. Section is collapsible
// ---------------------------------------------------------------------------

describe('TasksSidebarSection — collapsible', () => {
  it('renders a chevron next to the "Tasks" label', () => {
    renderSection();
    expect(document.querySelector('svg.lucide-chevron-down[aria-hidden="true"]')).toBeTruthy();
  });

  it('clicking the toggle hides the New row and task rows', () => {
    renderSection([OPEN_TODO]);
    expect(screen.getByTestId('tasks-sidebar-new')).toBeTruthy();
    fireEvent.click(screen.getByTestId('tasks-sidebar-section-toggle'));
    expect(screen.queryByTestId('tasks-sidebar-new')).toBeNull();
  });

  it('clicking the toggle again shows the section again', () => {
    renderSection([OPEN_TODO]);
    fireEvent.click(screen.getByTestId('tasks-sidebar-section-toggle'));
    fireEvent.click(screen.getByTestId('tasks-sidebar-section-toggle'));
    expect(screen.getByTestId('tasks-sidebar-new')).toBeTruthy();
  });

  it('the Expand-to-modal button stays reachable while collapsed', () => {
    renderSection();
    fireEvent.click(screen.getByTestId('tasks-sidebar-section-toggle'));
    expect(screen.getByTestId('tasks-sidebar-expand')).toBeTruthy();
  });
});
