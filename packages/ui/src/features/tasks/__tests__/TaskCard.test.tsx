/**
 * TaskCard.test.tsx
 *
 * Behaviors covered:
 *  1. Renders data-testid="tasks-card-<number>".
 *  2. dragstart writes todo.number to dataTransfer under 'todo-number'.
 *  3. dragstart applies a "being dragged" opacity affordance; dragend clears it
 *     (Tauri drag-and-drop fix — cards had no visual feedback while dragging).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TaskCard } from '../TaskCard';
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

function renderCard(overrides: Partial<Todo> & { id: string; number: number }) {
  render(
    <TooltipProvider>
      <TaskCard todo={makeTodo(overrides)} onEdit={vi.fn()} onDelete={vi.fn()} onStartSession={vi.fn()} />
    </TooltipProvider>,
  );
}

describe('TaskCard — root testid', () => {
  it('renders tasks-card-1', () => {
    renderCard({ id: 't1', number: 1 });
    expect(screen.getByTestId('tasks-card-1')).toBeTruthy();
  });
});

describe('TaskCard — native HTML5 drag payload', () => {
  it('writes todo.number to dataTransfer on dragstart', () => {
    renderCard({ id: 't1', number: 7 });
    const card = screen.getByTestId('tasks-card-7');
    const dataTransfer = { setData: vi.fn() };
    fireEvent.dragStart(card, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith('todo-number', '7');
  });
});

describe('TaskCard — dragging visual feedback', () => {
  it('applies a reduced-opacity state on dragstart', () => {
    renderCard({ id: 't1', number: 1 });
    const card = screen.getByTestId('tasks-card-1');
    expect(card.className).not.toContain('opacity-50');

    fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn() } });
    expect(card.className).toContain('opacity-50');
  });

  it('clears the reduced-opacity state on dragend', () => {
    renderCard({ id: 't1', number: 1 });
    const card = screen.getByTestId('tasks-card-1');

    fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn() } });
    expect(card.className).toContain('opacity-50');

    fireEvent.dragEnd(card);
    expect(card.className).not.toContain('opacity-50');
  });
});
