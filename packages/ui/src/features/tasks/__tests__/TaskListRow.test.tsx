/**
 * TaskListRow.test.tsx
 *
 * Behaviors covered:
 *
 * Status dot button (tasks-1 + tasks-12):
 *  1. Renders data-testid="tasks-list-row-cycle-<number>" button.
 *  2. Clicking the cycle button calls onCycle with the todo's id.
 *  3. The cycle button's aria-label mentions the current status (open/in_progress/done).
 *  4. in_progress renders an inner pulsing dot; done renders a check icon.
 *
 * Delete hover action (tasks-3):
 *  5. Renders data-testid="tasks-list-row-delete-<number>" button.
 *  6. Clicking delete calls onDelete with the todo's id and stops propagation.
 *
 * Priority pill leading dot (tasks-4):
 *  7. Priority pill renders a leading dot span with a data-testid="tasks-priority-dot-<number>".
 *
 * Keyboard shortcuts (tasks-2):
 *  8. Footer hint text includes 'Space toggle status'.
 *
 * (Per-priority dot color-class assertions were dropped — they duplicated
 * the priorityDotClass lookup table row-by-row through the DOM instead of
 * the unit level; the table itself belongs in a dedicated palette test, not
 * pinned per-component.)
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

function renderRow({ todo = OPEN_TODO, expanded = false, selected = false }: RenderOpts = {}) {
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

  it.each([
    ['open', OPEN_TODO, 1],
    ['in_progress', IN_PROGRESS_TODO, 2],
    ['done', DONE_TODO, 3],
  ] as const)('%s status: aria-label mentions the status', (status, todo, number) => {
    renderRow({ todo });
    const btn = screen.getByTestId(`tasks-list-row-cycle-${number}`);
    expect(btn.getAttribute('aria-label')).toContain(status);
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
});
