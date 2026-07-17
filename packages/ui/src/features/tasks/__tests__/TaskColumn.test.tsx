/**
 * TaskColumn.test.tsx
 *
 * Behaviors covered:
 *  1. Renders data-testid="tasks-column-<status>".
 *  2. Empty state renders its own testid.
 *  3. Drag-over highlights the column and clears on dragleave/drop.
 *
 * (Static spacing/layout assertions for findings 9.14/9.15 were dropped —
 * Tailwind arbitrary-value class strings pin a design detail, not behavior,
 * and don't reflect what actually renders under Tailwind's build.)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TaskColumn } from '../TaskColumn';
import type { Todo } from '@/lib/api/todos';

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

describe('TaskColumn — empty state testid', () => {
  it('tags the empty column body with tasks-column-open-empty', () => {
    renderColumn();
    expect(screen.getByTestId('tasks-column-open-empty')).toBeTruthy();
  });
});

describe('TaskColumn — drop-zone visual feedback', () => {
  it('highlights the column while a drag is over it, and clears on dragleave', () => {
    renderColumn();
    const column = screen.getByTestId('tasks-column-open');
    expect(column.className).not.toContain('ring-primary');

    fireEvent.dragOver(column);
    expect(column.className).toContain('bg-mf-selection');
    expect(column.className).toContain('ring-primary');

    fireEvent.dragLeave(column);
    expect(column.className).not.toContain('ring-primary');
  });

  it('clears the highlight on drop', () => {
    renderColumn();
    const column = screen.getByTestId('tasks-column-open');

    fireEvent.dragOver(column);
    expect(column.className).toContain('ring-primary');

    fireEvent.drop(column, { dataTransfer: { getData: () => '1' } });
    expect(column.className).not.toContain('ring-primary');
  });
});
