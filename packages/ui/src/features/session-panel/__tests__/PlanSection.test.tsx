/**
 * PlanSection — unit tests.
 *
 * Behaviors covered:
 *  - nothing renders without todos
 *  - folded keeps the counter and the step in progress on one line
 *  - open shows every step, each with its own state
 *  - the toggle reports back to the store that owns section open-state
 *
 * The tasks-list coverage this replaces lived in
 * the retired bottom panel's `TasksSection.test.tsx`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TodoItem } from '@qlan-ro/mainframe-types';

let mockTodos: TodoItem[] = [];
vi.mock('@/store/session-todos', () => ({ useSessionTodos: () => mockTodos }));

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectName: 'repo', projectId: 'proj-1', chatId: 'chat-9', isWorktree: false }),
}));

const { PlanSection } = await import('../PlanSection');

const todo = (content: string, status: TodoItem['status'], activeForm = `${content}ing`): TodoItem => ({
  content,
  status,
  activeForm,
});

const fivePart: TodoItem[] = [
  todo('Read the plan', 'completed'),
  todo('Write the tests', 'completed'),
  todo('Build the section', 'in_progress', 'Building the section'),
  todo('Run the suite', 'pending'),
  todo('Typecheck', 'pending'),
];

const onToggle = vi.fn();

beforeEach(() => {
  mockTodos = [];
  onToggle.mockReset();
});

describe('PlanSection', () => {
  it('renders nothing when the session has no todos', () => {
    const { container } = render(<PlanSection open={false} onToggle={onToggle} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('folded, keeps the counter and the step in progress', () => {
    mockTodos = fivePart;
    render(<PlanSection open={false} onToggle={onToggle} />);
    const toggle = screen.getByTestId('session-panel-plan-toggle');
    expect(toggle).toHaveTextContent('2 of 5');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('session-panel-plan-current')).toHaveTextContent('In progress: Building the section');
    expect(screen.queryByTestId('session-panel-plan-step-0')).toBeNull();
  });

  it('folded, says when every step is done', () => {
    mockTodos = [todo('One', 'completed'), todo('Two', 'completed')];
    render(<PlanSection open={false} onToggle={onToggle} />);
    expect(screen.getByTestId('session-panel-plan')).toHaveTextContent('All 2 steps done');
  });

  it('open, shows every step with its state', () => {
    mockTodos = fivePart;
    render(<PlanSection open onToggle={onToggle} />);
    expect(screen.getByTestId('session-panel-plan-step-0')).toHaveTextContent('Done: Read the plan');
    expect(screen.getByTestId('session-panel-plan-step-2')).toHaveTextContent('In progress: Building the section');
    expect(screen.getByTestId('session-panel-plan-step-4')).toHaveTextContent('To do: Typecheck');
    expect(screen.queryByTestId('session-panel-plan-current')).toBeNull();
  });

  it('marks the next step, with nothing spinning, when no step is in progress', () => {
    mockTodos = [todo('One', 'completed'), todo('Two', 'pending')];
    render(<PlanSection open onToggle={onToggle} />);
    expect(screen.getByTestId('session-panel-plan-step-1')).toHaveTextContent('Next: Two');
    expect(document.querySelector('.animate-spin')).toBeNull();
  });

  it('reports the toggle to its owner', () => {
    mockTodos = fivePart;
    render(<PlanSection open={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId('session-panel-plan-toggle'));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
