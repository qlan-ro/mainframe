/**
 * Behavior tests for BackgroundActivityBar — the chip above the composer that
 * surfaces live background work (agents / bg bash tasks / workflows).
 * Hardcoded expected labels; no production logic re-derived.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BackgroundActivityTask } from '@qlan-ro/mainframe-types';

let __backgroundTasks: Record<string, BackgroundActivityTask> = {};

vi.mock('../../runtime/use-chat-thread-runtime', () => ({
  useChatExtras: () => ({ state: { backgroundTasks: __backgroundTasks } }),
}));

import { BackgroundActivityBar } from '../BackgroundActivityBar';

function task(id: string, kind: BackgroundActivityTask['kind'], description: string, startedAt: number) {
  return { id, kind, description, startedAt };
}

describe('BackgroundActivityBar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(10 * 60_000); // t = 10 minutes
    __backgroundTasks = {};
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when there is no live background work', () => {
    render(<BackgroundActivityBar />);
    expect(screen.queryByTestId('composer-background-activity')).toBeNull();
  });

  it('shows counts by kind — agents, tasks, workflows', () => {
    __backgroundTasks = {
      'a-1': task('a-1', 'agent', 'reviewer', 0),
      'a-2': task('a-2', 'agent', 'tester', 0),
      'b-1': task('b-1', 'bash', 'pnpm dev', 0),
      'w-1': task('w-1', 'workflow', 'deploy', 0),
    };
    render(<BackgroundActivityBar />);
    expect(screen.getByTestId('composer-background-activity').textContent).toContain('2 agents · 1 task · 1 workflow');
  });

  it('uses singular labels for single items', () => {
    __backgroundTasks = { 'a-1': task('a-1', 'agent', 'reviewer', 0) };
    render(<BackgroundActivityBar />);
    expect(screen.getByTestId('composer-background-activity').textContent).toContain('1 agent');
  });

  it("counts 'other' kinds as tasks", () => {
    __backgroundTasks = {
      'o-1': task('o-1', 'other', 'mystery', 0),
      'b-1': task('b-1', 'bash', 'pnpm dev', 0),
    };
    render(<BackgroundActivityBar />);
    expect(screen.getByTestId('composer-background-activity').textContent).toContain('2 tasks');
  });

  it('opens a popover listing each task with description and elapsed time', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    __backgroundTasks = {
      'a-1': task('a-1', 'agent', 'reviewer subagent', 5 * 60_000), // started 5m ago
      'b-1': task('b-1', 'bash', 'pnpm dev', 10 * 60_000 - 20_000), // started 20s ago
    };
    render(<BackgroundActivityBar />);

    await user.click(screen.getByTestId('composer-background-activity'));

    const agentRow = screen.getByTestId('composer-background-activity-item-a-1');
    expect(agentRow.textContent).toContain('reviewer subagent');
    expect(agentRow.textContent).toContain('5m');

    const bashRow = screen.getByTestId('composer-background-activity-item-b-1');
    expect(bashRow.textContent).toContain('pnpm dev');
    expect(bashRow.textContent).toContain('<1m');
  });
});
