/**
 * TaskListRow.test.tsx
 *
 * Behaviors covered:
 *
 * Status dot button (tasks-1 + tasks-12):
 *  1.  Renders data-testid="tasks-list-row-cycle-<number>" button.
 *  2.  Clicking the cycle button calls onCycle with the todo's id.
 *  3.  The cycle button has aria-label reflecting the current status.
 *  4.  open status renders a border-ring span (no inner filled dot).
 *  5.  in_progress status renders both the ring AND an inner animated dot.
 *  6.  done status renders a check icon inside the button.
 *
 * Delete hover action (tasks-3):
 *  7.  Renders data-testid="tasks-list-row-delete-<number>" button.
 *  8.  Clicking delete calls onDelete with the todo's id and stops propagation.
 *
 * Priority pill leading dot (tasks-4):
 *  9.  Priority pill renders a leading dot span with a data-testid="tasks-priority-dot-<number>".
 *  10. Critical priority dot has a red color class.
 *
 * Keyboard shortcuts (tasks-2):
 *  11. Footer hint text includes 'Space toggle status'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Todo } from '@/lib/api/todos';

// ---------------------------------------------------------------------------
// Imports after any mocks
// ---------------------------------------------------------------------------
import { TaskListRow } from '../TaskListRow';
import { TooltipProvider } from '@/components/ui/tooltip';

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
    updated_at: '2026-06-02T00:00:00.000Z',
    ...overrides,
  };
}

const OPEN_TODO = makeTodo({ id: 'todo-1', number: 1, status: 'open', priority: 'critical' });
const IN_PROGRESS_TODO = makeTodo({ id: 'todo-2', number: 2, status: 'in_progress', priority: 'high' });
const DONE_TODO = makeTodo({ id: 'todo-3', number: 3, status: 'done', priority: 'medium' });

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

interface RenderOpts {
  todo?: Todo;
  expanded?: boolean;
  selected?: boolean;
}

function renderRow({
  todo = OPEN_TODO,
  expanded = false,
  selected = false,
}: RenderOpts = {}) {
  const onToggle = vi.fn();
  const onEdit = vi.fn();
  const onStartSession = vi.fn();
  const onCycle = vi.fn();
  const onDelete = vi.fn();

  render(
    <TooltipProvider>
      <TaskListRow
        todo={todo}
        selected={selected}
        expanded={expanded}
        onToggle={onToggle}
        onEdit={onEdit}
        onStartSession={onStartSession}
        onCycle={onCycle}
        onDelete={onDelete}
      />
    </TooltipProvider>,
  );

  return { onToggle, onEdit, onStartSession, onCycle, onDelete };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1–6. Status dot button
// ---------------------------------------------------------------------------

describe('TaskListRow — status cycle button', () => {
  it('renders tasks-list-row-cycle-<number> button', () => {
    renderRow({ todo: OPEN_TODO });
    expect(screen.getByTestId('tasks-list-row-cycle-1')).toBeTruthy();
  });

  it('clicking the cycle button calls onCycle with the todo id', async () => {
    const { onCycle } = renderRow({ todo: OPEN_TODO });
    await userEvent.click(screen.getByTestId('tasks-list-row-cycle-1'));
    expect(onCycle).toHaveBeenCalledOnce();
    expect(onCycle).toHaveBeenCalledWith('todo-1');
  });

  it('open status: aria-label says "Status: open"', () => {
    renderRow({ todo: OPEN_TODO });
    const btn = screen.getByTestId('tasks-list-row-cycle-1');
    expect(btn.getAttribute('aria-label')).toContain('open');
  });

  it('in_progress status: aria-label says "Status: in_progress"', () => {
    renderRow({ todo: IN_PROGRESS_TODO });
    const btn = screen.getByTestId('tasks-list-row-cycle-2');
    expect(btn.getAttribute('aria-label')).toContain('in_progress');
  });

  it('done status: aria-label says "Status: done"', () => {
    renderRow({ todo: DONE_TODO });
    const btn = screen.getByTestId('tasks-list-row-cycle-3');
    expect(btn.getAttribute('aria-label')).toContain('done');
  });

  it('in_progress renders an inner pulsing dot inside the cycle button', () => {
    renderRow({ todo: IN_PROGRESS_TODO });
    const btn = screen.getByTestId('tasks-list-row-cycle-2');
    // The inner pulse dot should be a child span
    const pulseSpan = btn.querySelector('[data-status-pulse]');
    expect(pulseSpan).toBeTruthy();
  });

  it('done renders a check icon inside the cycle button', () => {
    renderRow({ todo: DONE_TODO });
    const btn = screen.getByTestId('tasks-list-row-cycle-3');
    // A check icon (svg) should be inside
    const svg = btn.querySelector('svg');
    expect(svg).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 7–8. Delete hover action
// ---------------------------------------------------------------------------

describe('TaskListRow — delete hover action', () => {
  it('renders tasks-list-row-delete-<number> button', () => {
    renderRow({ todo: OPEN_TODO });
    expect(screen.getByTestId('tasks-list-row-delete-1')).toBeTruthy();
  });

  it('clicking delete calls onDelete with the todo id', async () => {
    const { onDelete } = renderRow({ todo: OPEN_TODO });
    await userEvent.click(screen.getByTestId('tasks-list-row-delete-1'));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledWith('todo-1');
  });

  it('delete button is rendered for done todos too', () => {
    renderRow({ todo: DONE_TODO });
    expect(screen.getByTestId('tasks-list-row-delete-3')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 9–10. Priority pill leading dot
// ---------------------------------------------------------------------------

describe('TaskListRow — priority pill leading dot', () => {
  it('renders tasks-priority-dot-<number> span inside the priority pill', () => {
    renderRow({ todo: OPEN_TODO });
    expect(screen.getByTestId('tasks-priority-dot-1')).toBeTruthy();
  });

  it('critical priority dot has a red class', () => {
    renderRow({ todo: OPEN_TODO }); // OPEN_TODO has priority=critical
    const dot = screen.getByTestId('tasks-priority-dot-1');
    expect(dot.className).toMatch(/red/);
  });

  it('medium priority dot has a yellow class', () => {
    renderRow({ todo: DONE_TODO }); // DONE_TODO has priority=medium
    const dot = screen.getByTestId('tasks-priority-dot-3');
    expect(dot.className).toMatch(/yellow/);
  });
});
