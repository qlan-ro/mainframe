/**
 * QuickTaskDialog.test.tsx
 *
 * Behaviors covered:
 *  1. Renders data-testid="tasks-quick-dialog" when open=true.
 *  2. Create button is disabled when title is empty.
 *  3. Create button is enabled when title is non-empty.
 *  4. Clicking Create with a title calls store.create with the right args.
 *  5. ⌘↵ on the title input and on the body textarea both call store.create.
 *  6. Does NOT render when open=false.
 *  7. store.create receives projectId in the input body.
 *
 * (title/body/create testid presence is exercised implicitly by the gating
 * and create-flow tests below — no bare presence smokes needed.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mock the todos store BEFORE importing the component
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();

vi.mock('../use-todos-store', () => ({
  useTodosStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = { create: mockCreate };
    return selector ? selector(state) : state;
  }),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { QuickTaskDialog } from '../QuickTaskDialog';

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

interface RenderOpts {
  open?: boolean;
  projectId?: string;
}

function renderDialog({ open = true, projectId = 'proj-abc' }: RenderOpts = {}) {
  const onClose = vi.fn();
  render(<QuickTaskDialog port={31415} projectId={projectId} open={open} onClose={onClose} />);
  return { onClose };
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: resolves successfully with a minimal Todo
  mockCreate.mockResolvedValue({
    id: 'created-todo',
    number: 1,
    project_id: 'proj-abc',
    title: '',
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
  });
});

// ---------------------------------------------------------------------------
// 1. Renders when open=true
// ---------------------------------------------------------------------------

describe('QuickTaskDialog — renders root testid when open', () => {
  it('renders data-testid="tasks-quick-dialog" when open=true', () => {
    renderDialog({ open: true });
    expect(screen.getByTestId('tasks-quick-dialog')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Priority pills — quick-add excludes Critical (design: 12-todos.jsx:793,
// finding 9.16). Fast-capture only offers low/medium/high.
// ---------------------------------------------------------------------------

describe('QuickTaskDialog — priority pills exclude Critical', () => {
  it('renders low/medium/high priority pills', () => {
    renderDialog();
    expect(screen.getByTestId('tasks-quick-priority-low')).toBeTruthy();
    expect(screen.getByTestId('tasks-quick-priority-medium')).toBeTruthy();
    expect(screen.getByTestId('tasks-quick-priority-high')).toBeTruthy();
  });

  it('does NOT render a Critical priority pill', () => {
    renderDialog();
    expect(screen.queryByTestId('tasks-quick-priority-critical')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5–6. Create button gating
// ---------------------------------------------------------------------------

describe('QuickTaskDialog — Create button gated on title', () => {
  it('Create button is disabled when title is empty', () => {
    renderDialog();
    const btn = screen.getByTestId('tasks-quick-create') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('Create button is enabled when title has content', async () => {
    renderDialog();
    await userEvent.type(screen.getByTestId('tasks-quick-title'), 'New feature');
    const btn = screen.getByTestId('tasks-quick-create') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Clicking Create button calls store.create
// ---------------------------------------------------------------------------

describe('QuickTaskDialog — clicking Create calls store.create', () => {
  it('calls store.create with title, type "feature", priority "medium", and calls onClose', async () => {
    const { onClose } = renderDialog({ projectId: 'proj-abc' });

    await userEvent.type(screen.getByTestId('tasks-quick-title'), 'My new task');
    await userEvent.click(screen.getByTestId('tasks-quick-create'));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledOnce();
    });

    const [calledPort, calledInput] = mockCreate.mock.calls[0] as [
      number,
      { title: string; type: string; priority: string; projectId: string },
    ];
    expect(calledPort).toBe(31415);
    expect(calledInput.title).toBe('My new task');
    expect(calledInput.type).toBe('feature');
    expect(calledInput.priority).toBe('medium');

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});

// ---------------------------------------------------------------------------
// 5. ⌘↵ on either the title input or the body textarea triggers create
// ---------------------------------------------------------------------------

describe('QuickTaskDialog — ⌘↵ triggers create from either field', () => {
  it.each([
    ['the title input', 'tasks-quick-title'],
    ['the body textarea', 'tasks-quick-body'],
  ])('calls store.create when Meta+Enter is pressed on %s', async (_label, testId) => {
    renderDialog();

    await userEvent.type(screen.getByTestId('tasks-quick-title'), 'Keyboard shortcut task');
    await userEvent.click(screen.getByTestId(testId));
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledOnce();
    });
  });
});

// ---------------------------------------------------------------------------
// 10. Does NOT render when open=false
// ---------------------------------------------------------------------------

describe('QuickTaskDialog — not rendered when open=false', () => {
  it('does NOT render tasks-quick-dialog when open=false', () => {
    renderDialog({ open: false });
    expect(screen.queryByTestId('tasks-quick-dialog')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11. store.create receives projectId in the input body
// ---------------------------------------------------------------------------

describe('QuickTaskDialog — projectId is passed to store.create', () => {
  it('passes the projectId to store.create as part of the input', async () => {
    renderDialog({ projectId: 'my-special-project' });

    await userEvent.type(screen.getByTestId('tasks-quick-title'), 'Scoped task');
    await userEvent.click(screen.getByTestId('tasks-quick-create'));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledOnce();
    });

    // store.create(port, input, projectId) — second arg is the input body
    const calledInput = mockCreate.mock.calls[0]?.[1] as { projectId: string };
    expect(calledInput.projectId).toBe('my-special-project');
  });
});
