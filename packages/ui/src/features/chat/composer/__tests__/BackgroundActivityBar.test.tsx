/**
 * Behavior tests for BackgroundActivityBar — the chip above the composer that
 * surfaces live background work (agents / bg bash tasks / workflows), and its
 * two-level activity popover (list ↔ a single run's panel).
 * Hardcoded expected labels; no production logic re-derived.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BackgroundActivityTask, ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';

let __backgroundTasks: Record<string, BackgroundActivityTask> = {};
let __chatId = 'chat-1';

vi.mock('../../runtime/use-chat-thread-runtime', () => ({
  useChatExtras: () => ({ state: { chatId: __chatId, backgroundTasks: __backgroundTasks } }),
}));

let __workflowRuns: Record<string, ClaudeWorkflowRun> = {};

vi.mock('../../workflow/use-workflow-run', () => ({
  useWorkflowRun: (taskId: string | undefined) => (taskId ? __workflowRuns[taskId] : undefined),
}));

import { BackgroundActivityBar } from '../BackgroundActivityBar';

function task(id: string, kind: BackgroundActivityTask['kind'], description: string, startedAt: number) {
  return { id, kind, description, startedAt };
}

function workflowTask(id: string, runId: string, workflowName: string, startedAt: number): BackgroundActivityTask {
  return { id, kind: 'workflow', description: workflowName, startedAt, workflowName, runId };
}

function workflowRun(overrides: Partial<ClaudeWorkflowRun> = {}): ClaudeWorkflowRun {
  return {
    taskId: 'w-1',
    runId: 'run_1',
    workflowName: 'deploy',
    status: 'running',
    source: 'snapshot',
    totalTokens: 0,
    durationMs: 0,
    phases: [],
    agents: [
      {
        agentId: 'a-1',
        index: 0,
        phaseIndex: 0,
        label: 'reviewer',
        state: 'progress',
        tokens: 0,
        toolCalls: 0,
        durationMs: 0,
      },
    ],
    ...overrides,
  };
}

describe('BackgroundActivityBar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(10 * 60_000); // t = 10 minutes
    __backgroundTasks = {};
    __workflowRuns = {};
    __chatId = 'chat-1';
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

  describe('two-level activity popover (AC 5, 6)', () => {
    it('lists a live workflow task as a clickable row with its name and agent count; agent/bash rows stay non-interactive', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      __backgroundTasks = {
        'a-1': task('a-1', 'agent', 'reviewer subagent', 0),
        'w-1': workflowTask('w-1', 'run_1', 'deploy', 0),
      };
      __workflowRuns = { 'w-1': workflowRun() };
      render(<BackgroundActivityBar />);

      await user.click(screen.getByTestId('composer-background-activity'));

      const workflowRow = screen.getByTestId('chat-background-workflow-run_1');
      expect(workflowRow.textContent).toContain('deploy');
      expect(workflowRow.textContent).toContain('1 agent');

      const agentRow = screen.getByTestId('composer-background-activity-item-a-1');
      expect(agentRow.tagName).not.toBe('BUTTON');
      await user.click(agentRow);
      // Clicking a non-workflow row is a no-op — the list is still showing.
      expect(screen.getByTestId('composer-background-activity-item-a-1')).toBeInTheDocument();
    });

    it('clicking a workflow row shows the run panel with a breadcrumb; clicking the breadcrumb returns to the list', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      __backgroundTasks = { 'w-1': workflowTask('w-1', 'run_1', 'deploy', 0) };
      __workflowRuns = { 'w-1': workflowRun() };
      render(<BackgroundActivityBar />);

      await user.click(screen.getByTestId('composer-background-activity'));
      await user.click(screen.getByTestId('chat-background-workflow-run_1'));

      expect(screen.getByTestId('chat-workflow-panel-run_1')).toBeInTheDocument();
      const breadcrumb = screen.getByTestId('chat-workflow-back-run_1');
      expect(breadcrumb.textContent).toContain('Background activity');

      await user.click(breadcrumb);

      expect(screen.getByTestId('chat-background-workflow-run_1')).toBeInTheDocument();
      expect(screen.queryByTestId('chat-workflow-panel-run_1')).not.toBeInTheDocument();
    });

    it('keeps the pill mounted while the popover is open even after the live set empties', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      __backgroundTasks = { 'a-1': task('a-1', 'agent', 'reviewer', 0) };
      const { rerender } = render(<BackgroundActivityBar />);

      await user.click(screen.getByTestId('composer-background-activity'));

      __backgroundTasks = {};
      rerender(<BackgroundActivityBar />);

      expect(screen.getByTestId('composer-background-activity')).toBeInTheDocument();
    });

    it('closes the popover when the chat id changes', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      __backgroundTasks = { 'w-1': workflowTask('w-1', 'run_1', 'deploy', 0) };
      __workflowRuns = { 'w-1': workflowRun() };
      const { rerender } = render(<BackgroundActivityBar />);

      await user.click(screen.getByTestId('composer-background-activity'));
      expect(screen.getByTestId('chat-background-workflow-run_1')).toBeInTheDocument();

      __chatId = 'chat-2';
      rerender(<BackgroundActivityBar />);

      expect(screen.queryByTestId('chat-background-workflow-run_1')).not.toBeInTheDocument();
    });
  });
});
