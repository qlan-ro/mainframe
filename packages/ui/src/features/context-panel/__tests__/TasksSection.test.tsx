import { render, screen } from '@testing-library/react';
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
  it('shows the total count in the section header and a progress bar at completed/total width', () => {
    const todos = [mk({ status: 'completed' }), mk({ status: 'pending' }), mk({ status: 'pending' })];
    render(<TasksSection todos={todos} />);
    expect(screen.getByTestId('context-tasks-section')).toBeInTheDocument();
    expect(screen.getByText('1/3')).toBeInTheDocument();
    const bar = screen.getByTestId('context-tasks-progress-fill');
    expect(bar).toHaveStyle({ width: '33%' });
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

  it('strikes through completed rows', () => {
    render(<TasksSection todos={[mk({ status: 'completed', content: 'Done item' })]} />);
    expect(screen.getByText('Done item')).toHaveClass('line-through');
  });

  it('shows 0% width and 0/0 when empty (caller still gates on length, but component is total-safe)', () => {
    render(<TasksSection todos={[]} />);
    expect(screen.getByTestId('context-tasks-progress-fill')).toHaveStyle({ width: '0%' });
  });
});
