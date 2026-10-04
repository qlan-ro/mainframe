/**
 * TaskSidebarRow — unit tests.
 *
 * D22: one 36px(ish) row — a status dot that cycles open → in progress →
 * done → open on click (stopping the row's own click), `#n`, a title that
 * fades only on overflow, and hover Start/Edit. The row itself opens the
 * edit modal.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Todo } from '@/lib/api/todos';
import { TaskSidebarRow, nextTodoStatus } from '../TaskSidebarRow';

function todo(over: Partial<Todo> = {}): Todo {
  return {
    id: 'todo-1',
    number: 7,
    project_id: 'proj-1',
    title: 'Fix the rail',
    body: '',
    status: 'open',
    type: 'feature',
    priority: 'medium',
    labels: [],
    assignees: [],
    milestone: null,
    dependencies: [],
    order_index: 0,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

const onCycle = vi.fn();
const onEdit = vi.fn();
const onStart = vi.fn();

function renderRow(t: Todo) {
  render(
    <TooltipProvider>
      <TaskSidebarRow todo={t} onCycle={onCycle} onEdit={onEdit} onStart={onStart} />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  onCycle.mockReset();
  onEdit.mockReset();
  onStart.mockReset();
});

describe('nextTodoStatus', () => {
  it('cycles open → in_progress → done → open', () => {
    expect(nextTodoStatus('open')).toBe('in_progress');
    expect(nextTodoStatus('in_progress')).toBe('done');
    expect(nextTodoStatus('done')).toBe('open');
  });
});

describe('TaskSidebarRow — content', () => {
  it('shows the task number and title', () => {
    renderRow(todo({ number: 11, title: 'Ship the panel' }));
    const row = screen.getByTestId('tasks-sidebar-row-11');
    expect(row).toHaveTextContent('#11');
    expect(row).toHaveTextContent('Ship the panel');
  });

  it('strikes through a done task’s title', () => {
    renderRow(todo({ number: 1, status: 'done' }));
    const title = screen.getByText('Fix the rail');
    expect(title.className).toContain('line-through');
  });
});

describe('TaskSidebarRow — clicking the row', () => {
  it('opens the edit modal via onEdit', () => {
    const t = todo();
    renderRow(t);
    fireEvent.click(screen.getByTestId('tasks-sidebar-row-7'));
    expect(onEdit).toHaveBeenCalledWith(t);
  });

  it('opens the edit modal on Enter and Space, via keyboard', () => {
    const t = todo();
    renderRow(t);
    const row = screen.getByTestId('tasks-sidebar-row-7');
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onEdit).toHaveBeenCalledTimes(2);
  });
});

describe('TaskSidebarRow — the status cycle button', () => {
  it('calls onCycle with the todo, and not onEdit (stops propagation)', () => {
    const t = todo();
    renderRow(t);
    fireEvent.click(screen.getByTestId('tasks-sidebar-cycle-7'));
    expect(onCycle).toHaveBeenCalledWith(t);
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe('TaskSidebarRow — hover actions', () => {
  it('offers Start for an open or in-progress task, calling onStart without also editing', () => {
    const t = todo({ status: 'in_progress' });
    renderRow(t);
    fireEvent.click(screen.getByTestId('tasks-sidebar-start-7'));
    expect(onStart).toHaveBeenCalledWith(t);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('offers no Start button for a done task', () => {
    renderRow(todo({ status: 'done' }));
    expect(screen.queryByTestId('tasks-sidebar-start-7')).toBeNull();
  });

  it('offers Edit for every status, calling onEdit without cycling', () => {
    const t = todo({ status: 'done' });
    renderRow(t);
    fireEvent.click(screen.getByTestId('tasks-sidebar-edit-7'));
    expect(onEdit).toHaveBeenCalledWith(t);
    expect(onCycle).not.toHaveBeenCalled();
  });
});
