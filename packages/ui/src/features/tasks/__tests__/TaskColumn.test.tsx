/**
 * TaskColumn.test.tsx
 *
 * Behaviors covered:
 *  1.  Renders data-testid="tasks-column-<status>".
 *  2.  Card list uses a 9px gap (finding 9.14 — design 12-todos.jsx:621).
 *  3.  Column header count chip sits directly adjacent to the label at a 7px
 *      gap, NOT pushed to the far right via ml-auto (finding 9.15 — verifier
 *      correction: the design places the chip beside the label, not
 *      right-aligned).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TaskColumn } from '../TaskColumn';
import type { Todo } from '@/lib/api/todos';

function makeTodo(overrides: Partial<Todo> & { id: string; number: number }): Todo {
  return {
    project_id: 'proj-1',
    title: 'Task',
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

function renderColumn(todos: Todo[] = []) {
  render(
    <TooltipProvider>
      <TaskColumn
        status="open"
        todos={todos}
        onDrop={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onStartSession={vi.fn()}
      />
    </TooltipProvider>,
  );
}

describe('TaskColumn — root testid', () => {
  it('renders tasks-column-open', () => {
    renderColumn();
    expect(screen.getByTestId('tasks-column-open')).toBeTruthy();
  });
});

describe('TaskColumn — card list gap (finding 9.14)', () => {
  it('applies a 9px gap on the scrollable card list', () => {
    renderColumn([makeTodo({ id: 't1', number: 1 })]);
    const cardList = screen.getByTestId('tasks-card-1').parentElement as HTMLElement;
    expect(cardList.className).toContain('gap-[9px]');
  });
});

describe('TaskColumn — empty state testid', () => {
  it('tags the empty column body with tasks-column-open-empty', () => {
    renderColumn();
    expect(screen.getByTestId('tasks-column-open-empty')).toBeTruthy();
  });
});

describe('TaskColumn — header chip adjacency (finding 9.15)', () => {
  it('does NOT push the count chip to the far right via ml-auto', () => {
    renderColumn([makeTodo({ id: 't1', number: 1 })]);
    const chip = screen.getByText('1');
    expect(chip.className).not.toContain('ml-auto');
  });

  it('places the count chip in the header row with a 7px gap from the label', () => {
    renderColumn();
    const label = screen.getByText('Open');
    const header = label.parentElement as HTMLElement;
    expect(header.className).toContain('gap-[7px]');
  });
});
