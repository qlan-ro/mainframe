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

  it('Kill button is enabled for a running task', () => {
    render(<BackgroundTasksPopover chatId="c1" tasks={[task()]} />);
    expect((screen.getByTestId('bg-task-kill-t1') as HTMLButtonElement).disabled).toBe(false);
  });

  it('calls killBackgroundTaskApi on Kill click', async () => {
    render(<BackgroundTasksPopover chatId="c1" tasks={[task()]} />);
    fireEvent.click(screen.getByTestId('bg-task-kill-t1'));
    await waitFor(() => expect(killBackgroundTaskApi).toHaveBeenCalledWith('c1', 't1'));
  });

  it('filters out non-running tasks defensively', () => {
    const tasks = [
      task({ id: 'running-1', status: 'running' }),
      task({ id: 'done-1', status: 'completed', outputPath: '/x', endedAt: Date.now() }),
      task({ id: 'stopped-1', status: 'stopped', endedAt: Date.now() }),
    ];
    render(<BackgroundTasksPopover chatId="c1" tasks={tasks} />);
    expect(screen.getByTestId('bg-task-row-running-1')).toBeTruthy();
    expect(screen.queryByTestId('bg-task-row-done-1')).toBeNull();
    expect(screen.queryByTestId('bg-task-row-stopped-1')).toBeNull();
  });
});
