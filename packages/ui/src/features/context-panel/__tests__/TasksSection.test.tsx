import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { TodoItem } from '@qlan-ro/mainframe-types';
import { TasksSection } from '../TasksSection';

const mk = (over: Partial<TodoItem>): TodoItem => ({
  content: 'task',
  status: 'pending',
  activeForm: 'doing task',
  ...over,
});

describe('TasksSection', () => {
  it('renders the progress fill and done/total label inside the header, at completed/total width', () => {
    const todos = [mk({ status: 'completed' }), mk({ status: 'pending' }), mk({ status: 'pending' })];
    render(<TasksSection todos={todos} />);
    expect(screen.getByTestId('context-tasks-section')).toBeInTheDocument();

    const header = screen.getByTestId('sidebar-context-section-tasks');
    const bar = within(header).getByTestId('context-tasks-progress-fill');
    expect(bar).toHaveStyle({ width: '33%' });
    expect(within(header).getByText('1/3')).toBeInTheDocument();
  });

  it('renders a 2/3 label and 67% width for two completed of three', () => {
    const todos = [mk({ status: 'completed' }), mk({ status: 'completed' }), mk({ status: 'pending' })];
    render(<TasksSection todos={todos} />);

    const header = screen.getByTestId('sidebar-context-section-tasks');
    const bar = within(header).getByTestId('context-tasks-progress-fill');
    expect(bar).toHaveStyle({ width: '67%' });
    expect(within(header).getByText('2/3')).toBeInTheDocument();
  });

  it('does not render a count badge in the header', () => {
    const todos = [mk({ status: 'completed' }), mk({ status: 'pending' }), mk({ status: 'pending' })];
    render(<TasksSection todos={todos} />);

    const header = screen.getByTestId('sidebar-context-section-tasks');
    expect(within(header).queryByText('3')).not.toBeInTheDocument();
  });

  it('does not render a progress row outside the header', () => {
    const todos = [mk({ status: 'completed' }), mk({ status: 'pending' }), mk({ status: 'pending' })];
    render(<TasksSection todos={todos} />);

    const section = screen.getByTestId('context-tasks-section');
    const header = screen.getByTestId('sidebar-context-section-tasks');
    const allFills = within(section).getAllByTestId('context-tasks-progress-fill');
    expect(allFills).toHaveLength(1);
    expect(header).toContainElement(allFills[0] ?? null);
  });

  it('renders content for pending and activeForm for in_progress', () => {
    render(
      <TasksSection
        todos={[
          mk({ status: 'pending', content: 'Write tests' }),
          mk({ status: 'in_progress', content: 'Wire route', activeForm: 'Wiring route' }),
        ]}
      />,
    );
    expect(screen.getByText('Write tests')).toBeInTheDocument();
    expect(screen.getByText('Wiring route')).toBeInTheDocument();
    expect(screen.queryByText('Wire route')).not.toBeInTheDocument();
  });

  it('renders task rows with done styling for completed items', () => {
    render(<TasksSection todos={[mk({ status: 'completed', content: 'Done item' })]} />);
    const row = screen.getByTestId('context-task-row-Done item');
    expect(within(row).getByText('Done item')).toHaveClass('line-through');
  });

  it('shows 0% width and 0/0 in the header when empty', () => {
    render(<TasksSection todos={[]} />);
    const header = screen.getByTestId('sidebar-context-section-tasks');
    expect(within(header).getByTestId('context-tasks-progress-fill')).toHaveStyle({ width: '0%' });
    expect(within(header).getByText('0/0')).toBeInTheDocument();
  });
});
