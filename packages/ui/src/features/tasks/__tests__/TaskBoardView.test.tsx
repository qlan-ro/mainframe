/**
 * TaskBoardView.test.tsx
 *
 * Behavior covered: a drop resolves `onMove`'s projectId from the DROPPED
 * todo's own `project_id` — never a single board-level project, since a
 * merged (multi-project) board has no one project of its own any more.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TaskBoardView } from '../TaskBoardView';
import type { Todo } from '@/lib/api/todos';

function makeTodo(overrides: Partial<Todo> & { id: string; number: number; project_id: string }): Todo {
  return {
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

const TODO_A = makeTodo({ id: 'todo-a', number: 1, project_id: 'proj-1', status: 'open' });
const TODO_B = makeTodo({ id: 'todo-b', number: 2, project_id: 'proj-2', status: 'open' });

describe('TaskBoardView — a drop uses the dropped todo’s own project', () => {
  it('calls onMove with the dragged todo’s project id, not any other todo’s', () => {
    const onMove = vi.fn();
    render(
      <TooltipProvider>
        <TaskBoardView
          port={31415}
          todos={[TODO_A, TODO_B]}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onStartSession={vi.fn()}
          onMove={onMove}
        />
      </TooltipProvider>,
    );

    const inProgressColumn = screen.getByTestId('tasks-column-in_progress');
    fireEvent.drop(inProgressColumn, { dataTransfer: { getData: () => '2' } });

    expect(onMove).toHaveBeenCalledWith(31415, 'todo-b', 'in_progress', 'proj-2');
  });
});
