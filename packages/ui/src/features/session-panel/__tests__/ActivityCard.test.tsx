/**
 * ActivityCard — unit tests.
 *
 * Two-level coverage ported from `chat/composer/__tests__/BackgroundActivityBar.test.tsx`
 * (deleted in T5.1): the row list, the workflow drill-in and its way back, and
 * the chat-switch reset — which the popover got for free from Radix unmounting
 * its content, and this always-mounted card must do itself.
 *
 * Behaviors covered:
 *  - the empty state keeps the card header and shows one muted placeholder row,
 *    with no count badge (D6)
 *  - one row per live task, with its description, elapsed time and kind glyph
 *  - the count badge appears only while work is running
 *  - the header X closes the panel
 *  - a live workflow row drills into its run panel; the breadcrumb comes back
 *  - agent/bash rows are inert
 *  - switching chats resets the drill-in
 *
 * Mocked dependencies: `useChatExtras` (tasks + chat id) and `useWorkflowRun`.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, within } from '@testing-library/react';
import type { BackgroundActivityTask, ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';

let mockTasks: Record<string, BackgroundActivityTask> = {};
let mockChatId = 'chat-1';
vi.mock('@/features/chat/runtime/chat-extras', () => ({
  useChatExtras: () => ({ state: { chatId: mockChatId, backgroundTasks: mockTasks } }),
}));

let mockRuns: Record<string, ClaudeWorkflowRun> = {};
vi.mock('@/features/chat/workflow/use-workflow-run', () => ({
  useWorkflowRun: (taskId: string | undefined) => (taskId ? mockRuns[taskId] : undefined),
}));

const { ActivityCard } = await import('../ActivityCard');

const render = (ui: Parameters<typeof rtlRender>[0]) => rtlRender(ui, { wrapper: TooltipProvider });

function task(id: string, kind: BackgroundActivityTask['kind'], description: string, startedAt = 0) {
  return { id, kind, description, startedAt } as BackgroundActivityTask;
}

function workflowTask(id: string, runId: string, workflowName: string): BackgroundActivityTask {
  return { id, kind: 'workflow', description: workflowName, startedAt: 0, workflowName, runId };
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

const onClose = vi.fn();
const card = () => <ActivityCard onClose={onClose} />;
const badge = () => screen.getByTestId('session-panel-card-activity').querySelector('[data-slot="badge"]');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(10 * 60_000); // t = 10 minutes
  mockTasks = {};
  mockRuns = {};
  mockChatId = 'chat-1';
  onClose.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ActivityCard — empty (D6)', () => {
  it('keeps the card and shows one muted placeholder row', () => {
    render(card());
    expect(screen.getByTestId('session-panel-card-activity')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-activity-empty')).toHaveTextContent('Nothing running');
  });

  it('shows no count badge with nothing running', () => {
    render(card());
    expect(badge()).toBeNull();
  });
});

describe('ActivityCard — card chrome', () => {
  it('titles the card Activity', () => {
    render(card());
    expect(screen.getByTestId('session-panel-card-activity')).toHaveTextContent('Activity');
  });

  it('closes the panel from the header X', () => {
    render(card());
    fireEvent.click(screen.getByTestId('session-panel-card-close-activity'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ActivityCard — task rows', () => {
  it('renders one row per live task with its description and elapsed time', () => {
    mockTasks = {
      'a-1': task('a-1', 'agent', 'reviewer subagent', 5 * 60_000), // started 5m ago
      'b-1': task('b-1', 'bash', 'pnpm dev', 10 * 60_000 - 20_000), // started 20s ago
    };
    render(card());

    expect(screen.getByTestId('session-panel-task-a-1')).toHaveTextContent('reviewer subagent');
    expect(screen.getByTestId('session-panel-task-a-1')).toHaveTextContent('5m');
    expect(screen.getByTestId('session-panel-task-b-1')).toHaveTextContent('pnpm dev');
    expect(screen.getByTestId('session-panel-task-b-1')).toHaveTextContent('<1m');
    expect(screen.queryByTestId('session-panel-activity-empty')).toBeNull();
  });

  it('counts the running work in the card badge', () => {
    mockTasks = { 'a-1': task('a-1', 'agent', 'reviewer'), 'b-1': task('b-1', 'bash', 'pnpm dev') };
    render(card());
    expect(badge()).toHaveTextContent('2');
  });

  it('leads each row with its kind glyph — agent, task, or other', () => {
    mockTasks = {
      'a-1': task('a-1', 'agent', 'reviewer'),
      'b-1': task('b-1', 'bash', 'pnpm dev'),
      'c-1': task('c-1', 'other', 'mystery work'),
    };
    render(card());

    expect(within(screen.getByTestId('session-panel-task-a-1')).getByTestId('session-panel-kind-agent')).toBeVisible();
    expect(within(screen.getByTestId('session-panel-task-b-1')).getByTestId('session-panel-kind-bash')).toBeVisible();
    expect(within(screen.getByTestId('session-panel-task-c-1')).getByTestId('session-panel-kind-other')).toBeVisible();
  });

  it('leaves agent and bash rows inert — there is nothing to drill into', () => {
    mockTasks = { 'a-1': task('a-1', 'agent', 'reviewer subagent') };
    render(card());
    expect(screen.getByTestId('session-panel-task-a-1').tagName).not.toBe('BUTTON');
  });
});

describe('ActivityCard — workflow drill-in', () => {
  beforeEach(() => {
    mockTasks = { 'w-1': workflowTask('w-1', 'run_1', 'deploy'), 'a-1': task('a-1', 'agent', 'reviewer subagent') };
    mockRuns = { 'w-1': workflowRun() };
  });

  it('lists a live workflow as a clickable row carrying its name and agent count', () => {
    render(card());
    const row = screen.getByTestId('session-panel-workflow-run_1');
    expect(row.tagName).toBe('BUTTON');
    expect(row).toHaveTextContent('deploy');
    expect(row).toHaveTextContent('1 agent');
  });

  it('falls back to a plain task row while the run is unknown', () => {
    mockRuns = {};
    render(card());
    expect(screen.queryByTestId('session-panel-workflow-run_1')).toBeNull();
    expect(screen.getByTestId('session-panel-task-w-1')).toHaveTextContent('deploy');
  });

  it('opens the run panel, and the breadcrumb returns to the list', () => {
    render(card());
    fireEvent.click(screen.getByTestId('session-panel-workflow-run_1'));

    expect(screen.getByTestId('chat-workflow-panel-run_1')).toBeInTheDocument();
    expect(screen.queryByTestId('session-panel-task-a-1')).toBeNull();

    fireEvent.click(screen.getByTestId('session-panel-workflow-back-run_1'));

    expect(screen.queryByTestId('chat-workflow-panel-run_1')).toBeNull();
    expect(screen.getByTestId('session-panel-workflow-run_1')).toBeInTheDocument();
  });

  it('resets the drill-in when the chat id changes (M6)', () => {
    const { rerender } = render(card());
    fireEvent.click(screen.getByTestId('session-panel-workflow-run_1'));
    expect(screen.getByTestId('chat-workflow-panel-run_1')).toBeInTheDocument();

    mockChatId = 'chat-2';
    rerender(card());

    expect(screen.queryByTestId('chat-workflow-panel-run_1')).toBeNull();
    expect(screen.getByTestId('session-panel-workflow-run_1')).toBeInTheDocument();
  });
});
