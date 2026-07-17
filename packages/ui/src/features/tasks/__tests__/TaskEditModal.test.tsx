/**
 * TaskEditModal.test.tsx
 *
 * Behaviors covered:
 *  1. Save button is disabled when title is empty.
 *  2. Save button is disabled when title is whitespace-only.
 *  3. Save button is enabled when title has non-whitespace content.
 *  4. New-task mode: clicking Save with a title calls store.create.
 *  5. Edit-task mode: clicking Save calls store.update with the existing todo's id.
 *  6. Clicking Cancel calls onClose without saving.
 *  7. In edit mode, renders tasks-edit-delete button.
 *  8. In new mode, tasks-edit-delete button is NOT rendered.
 *  9. Dialog title says "New Task" in create mode and "Edit Task" in edit mode.
 *
 * (title/save/cancel testid presence is exercised implicitly by the gating,
 * create/update, and cancel tests below — no bare presence smokes needed.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mock the todos store BEFORE importing the component
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockRemove = vi.fn();

vi.mock('../use-todos-store', () => ({
  useTodosStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      create: mockCreate,
      update: mockUpdate,
      remove: mockRemove,
    };
    return selector ? selector(state) : state;
  }),
}));

// Mock TaskAttachments to avoid FileReader / attachment API complexity
vi.mock('../TaskAttachments', () => ({
  TaskAttachments: () => <div data-testid="tasks-attach-stub" />,
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { TaskEditModal } from '../TaskEditModal';
import type { Todo } from '@/lib/api/todos';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTodo(overrides: Partial<Todo> & { id: string }): Todo {
  return {
    number: 3,
    project_id: 'proj-1',
    title: 'Existing task',
    body: 'Some description',
    status: 'open',
    type: 'bug',
    priority: 'high',
    labels: [],
    assignees: [],
    milestone: null,
    dependencies: [],
    order_index: 0,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-02T00:00:00.000Z',
    ...overrides,
  };
}

const EXISTING_TODO = makeTodo({ id: 'todo-xyz', number: 3, title: 'Existing task' });

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

interface RenderOpts {
  todo?: Todo | null;
}

function renderModal({ todo = null }: RenderOpts = {}) {
  const onClose = vi.fn();
  render(
    <TaskEditModal
      port={31415}
      projectId="proj-1"
      todo={todo}
      allTodos={todo ? [todo] : []}
      allLabels={[]}
      onClose={onClose}
    />,
  );
  return { onClose };
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue({ id: 'new-todo', title: 'created' });
  mockUpdate.mockResolvedValue(undefined);
  mockRemove.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// 4–6. Required-title gating
//
// (title/save/cancel testid presence is exercised implicitly by the gating,
// create/update, and cancel tests below — no bare presence smokes needed.)
// ---------------------------------------------------------------------------

describe('TaskEditModal — Save button is gated on a non-empty title', () => {
  it('Save is disabled when title is empty (initial new-task state)', () => {
    renderModal();
    const save = screen.getByTestId('tasks-edit-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('Save is disabled when title contains only whitespace', async () => {
    renderModal();
    await userEvent.type(screen.getByTestId('tasks-edit-title'), '   ');
    const save = screen.getByTestId('tasks-edit-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('Save is enabled when title has non-whitespace content', async () => {
    renderModal();
    await userEvent.type(screen.getByTestId('tasks-edit-title'), 'Fix the bug');
    const save = screen.getByTestId('tasks-edit-save') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. New-task mode: Save calls store.create
// ---------------------------------------------------------------------------

describe('TaskEditModal — new-task mode: Save calls store.create', () => {
  it('calls store.create with the entered title and closes the modal', async () => {
    const { onClose } = renderModal({ todo: null });

    await userEvent.type(screen.getByTestId('tasks-edit-title'), 'New task from test');
    await userEvent.click(screen.getByTestId('tasks-edit-save'));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledOnce();
    });

    // Verify the title was passed
    const [calledPort, calledInput] = mockCreate.mock.calls[0] as [number, { title: string }];
    expect(calledPort).toBe(31415);
    expect(calledInput.title).toBe('New task from test');

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});

// ---------------------------------------------------------------------------
// 8. Edit-task mode: Save calls store.update
// ---------------------------------------------------------------------------

describe('TaskEditModal — edit-task mode: Save calls store.update', () => {
  it('calls store.update with the existing todo id and closes the modal', async () => {
    const { onClose } = renderModal({ todo: EXISTING_TODO });

    // Clear the pre-filled title and type a new one
    const titleInput = screen.getByTestId('tasks-edit-title');
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Updated title');
    await userEvent.click(screen.getByTestId('tasks-edit-save'));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledOnce();
    });

    const [calledPort, calledId, calledInput] = mockUpdate.mock.calls[0] as [number, string, { title: string }];
    expect(calledPort).toBe(31415);
    expect(calledId).toBe('todo-xyz');
    expect(calledInput.title).toBe('Updated title');

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});

// ---------------------------------------------------------------------------
// 9. Cancel calls onClose without saving
// ---------------------------------------------------------------------------

describe('TaskEditModal — Cancel calls onClose without calling create or update', () => {
  it('calls onClose exactly once when Cancel is clicked', async () => {
    const { onClose } = renderModal();

    await userEvent.click(screen.getByTestId('tasks-edit-cancel'));

    expect(onClose).toHaveBeenCalledOnce();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 10–11. Delete button presence
// ---------------------------------------------------------------------------

describe('TaskEditModal — delete button presence', () => {
  it('renders tasks-edit-delete in edit mode', () => {
    renderModal({ todo: EXISTING_TODO });
    expect(screen.getByTestId('tasks-edit-delete')).toBeTruthy();
  });

  it('does NOT render tasks-edit-delete in new-task mode', () => {
    renderModal({ todo: null });
    expect(screen.queryByTestId('tasks-edit-delete')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 12. Dialog title text
// ---------------------------------------------------------------------------

describe('TaskEditModal — dialog title text', () => {
  it('shows "New Task" in create mode', () => {
    renderModal({ todo: null });
    expect(screen.getByText('New Task')).toBeTruthy();
  });

  it('shows "Edit Task #<number>" in edit mode', () => {
    renderModal({ todo: EXISTING_TODO });
    expect(screen.getByText(`Edit Task #${EXISTING_TODO.number}`)).toBeTruthy();
  });
});
