import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import type { ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import type { ActivityEntry } from '../activity-model';

const actions = vi.hoisted(() => ({ stop: vi.fn(), cancel: vi.fn(), output: vi.fn() }));
vi.mock('@/lib/api/background-tasks', () => ({
  stopBackgroundTask: actions.stop,
  cancelDelegatedTask: actions.cancel,
  readBackgroundTaskOutput: actions.output,
}));
const { ActivityRow } = await import('../ActivityRow');

const task: BackgroundTask = {
  id: 'a-1',
  kind: 'agent',
  toolName: 'Bash',
  toolUseId: 'call-1',
  command: '',
  description: 'Review',
  outputPath: null,
  startedAt: 0,
  endedAt: null,
  status: 'running',
  lastOutputLine: null,
  summary: null,
  usage: null,
};
const agent: ActivityEntry = {
  id: 'task:a-1',
  kind: 'subagent',
  title: 'Review',
  detail: 'explorer',
  state: 'running',
  startedAt: 0,
  task,
};

beforeEach(() => {
  vi.clearAllMocks();
  actions.stop.mockResolvedValue(undefined);
  actions.cancel.mockResolvedValue(undefined);
});

it('stops a Claude agent by task id and does not expose Stop for Codex', async () => {
  const view = render(<ActivityRow row={agent} now={60_000} chatId="parent" adapterId="claude" onJump={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Stop Review' }));
  await waitFor(() => expect(actions.stop).toHaveBeenCalledWith('parent', 'a-1'));
  view.rerender(<ActivityRow row={agent} now={60_000} chatId="parent" adapterId="codex" onJump={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Stop Review' })).toBeNull();
});

it('cancels only the delegated task identified by the row', async () => {
  const delegated: ActivityEntry = {
    id: 'delegated:t-1',
    kind: 'delegated',
    title: 'Check tests',
    detail: 'Child chat',
    state: 'running',
    startedAt: 0,
    delegated: {
      taskId: 't-1',
      itemId: 'child',
      title: 'Check tests',
      status: 'running',
      waiting: false,
      updatedAt: 0,
    },
  };
  const view = render(<ActivityRow row={delegated} now={60_000} chatId="parent" onJump={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Check tests' }));
  await waitFor(() => expect(actions.cancel).toHaveBeenCalledWith('parent', 't-1'));
  view.rerender(
    <ActivityRow row={{ ...delegated, state: 'cancelled' }} now={60_000} chatId="parent" onJump={() => {}} />,
  );
  expect(screen.getByText('Child chat · cancelled')).toBeInTheDocument();
});

it('uses the same current phase in the workflow subtitle and rail', () => {
  const workflow: ActivityEntry = { ...agent, kind: 'workflow', title: 'Release', detail: 'Workflow' };
  const run = {
    phases: [
      { index: 0, title: 'Scan' },
      { index: 1, title: 'Review' },
      { index: 2, title: 'Verify' },
    ],
    agents: [
      { phaseIndex: 1, state: 'progress' },
      { phaseIndex: 2, state: 'start' },
    ],
  } as unknown as ClaudeWorkflowRun;
  render(<ActivityRow row={workflow} run={run} now={60_000} chatId="parent" onJump={() => {}} />);
  expect(screen.getByText('Verify · phase 3 of 3 · 2 agents running')).toBeInTheDocument();
  expect(screen.getByLabelText('Workflow phase 3 of 3')).toBeInTheDocument();
});
