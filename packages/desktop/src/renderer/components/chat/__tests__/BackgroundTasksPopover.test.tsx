import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BackgroundTasksPopover } from '../BackgroundTasksPopover.js';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';

vi.mock('../../../lib/api/background-tasks-api.js', () => ({
  killBackgroundTaskApi: vi.fn().mockResolvedValue(undefined),
  getBackgroundTaskOutput: vi.fn().mockResolvedValue('hello world'),
}));

import { killBackgroundTaskApi } from '../../../lib/api/background-tasks-api.js';

function task(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: 't1',
    toolName: 'Bash',
    toolUseId: 'tu',
    command: 'pnpm dev',
    description: '',
    outputPath: null,
    startedAt: Date.now(),
    endedAt: null,
    status: 'running',
    lastOutputLine: 'compiling...',
    summary: null,
    usage: null,
    ...overrides,
  };
}

describe('BackgroundTasksPopover', () => {
  it('renders one row per task', () => {
    render(<BackgroundTasksPopover chatId="c1" tasks={[task({ id: 'a' }), task({ id: 'b' })]} />);
    expect(screen.getByTestId('bg-task-row-a')).toBeTruthy();
    expect(screen.getByTestId('bg-task-row-b')).toBeTruthy();
  });

  it('disables View for running tasks (outputPath null)', () => {
    render(<BackgroundTasksPopover chatId="c1" tasks={[task({ status: 'running', outputPath: null })]} />);
    expect((screen.getByTestId('bg-task-view-t1') as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables Kill for non-running tasks', () => {
    render(<BackgroundTasksPopover chatId="c1" tasks={[task({ status: 'completed', outputPath: '/x' })]} />);
    expect((screen.getByTestId('bg-task-kill-t1') as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls killBackgroundTaskApi on Kill click', async () => {
    render(<BackgroundTasksPopover chatId="c1" tasks={[task()]} />);
    fireEvent.click(screen.getByTestId('bg-task-kill-t1'));
    await waitFor(() => expect(killBackgroundTaskApi).toHaveBeenCalledWith('c1', 't1'));
  });
});
