/**
 * PlanSection — unit tests.
 *
 * Behaviors covered:
 *  - nothing renders without todos (the rail has no Plan button, so there is no
 *    dangling scroll target to keep alive)
 *  - the element's own header carries the counter, and one step renders per todo
 *  - an in-progress todo shows its `activeForm`, not its `content`
 *  - collapsed hides the steps but keeps the header AND the progress bar
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
    const { container } = render(<PlanSection open onToggle={onToggle} />);
    expect(screen.queryByTestId('session-panel-plan')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('counts the completed steps in the header', () => {
    mockTodos = fivePart;
    render(<PlanSection open onToggle={onToggle} />);
    expect(screen.getByTestId('session-panel-plan-toggle')).toHaveTextContent('2 of 5');
  });

  it('renders one step per todo, using the active form for the running one', () => {
    mockTodos = fivePart;
    render(<PlanSection open onToggle={onToggle} />);
    expect(screen.getByTestId('session-panel-plan-step-0')).toHaveTextContent('Read the plan');
    expect(screen.getByTestId('session-panel-plan-step-2')).toHaveTextContent('Building the section');
    expect(screen.getByTestId('session-panel-plan-step-4')).toHaveTextContent('Typecheck');
    expect(screen.queryByTestId('session-panel-plan-step-5')).toBeNull();
  });

  it('collapsed hides the steps but keeps the header and the progress bar', () => {
    mockTodos = fivePart;
    render(<PlanSection open={false} onToggle={onToggle} />);
    expect(screen.getByTestId('session-panel-plan-toggle')).toHaveTextContent('2 of 5');
    expect(screen.getByTestId('session-panel-plan-progress')).toBeInTheDocument();
    expect(screen.queryByTestId('session-panel-plan-step-0')).toBeNull();
  });

  it('reports a toggle to its owner', () => {
    mockTodos = fivePart;
    render(<PlanSection open onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId('session-panel-plan-toggle'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
