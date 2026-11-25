import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ToolPart, TurnUnit } from '../../view-model/turn/types';
import type { TaskResultMarker } from '../../markers/agent-message';
import { TranscriptScopeProvider } from '../../messages/turn/transcript-scope';
import { auiState, entry, setSessions, switchToThread } from './fixtures';

const { unarchive, result } = vi.hoisted(() => ({
  unarchive: vi.fn().mockResolvedValue(undefined),
  result: { current: undefined as TaskResultMarker | undefined },
}));

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (sel: (s: typeof auiState) => unknown) => sel(auiState),
  useAui: () => ({
    threads: {
      switchToThread,
      item: () => ({ unarchive }),
      getState: () => ({ mainThreadId: auiState.threadListItem?.id, threadItems: auiState.threads.threadItems }),
    },
  }),
}));
vi.mock('../use-task-result', () => ({ useTaskResult: () => result.current }));
vi.mock('../../messages/turn/AgentSteps', () => ({
  AgentSteps: (props: { prompt?: string; result?: string; outcome: string }) => (
    <div data-testid="stub-steps" data-outcome={props.outcome}>
      {props.prompt}|{props.result}
    </div>
  ),
}));
vi.mock('../TaskChatSteps', () => ({
  TaskChatSteps: (props: { chatId: string; taskId: string; result?: string }) => (
    <div data-testid="stub-task-chat">{`${props.chatId}:${props.taskId}:${props.result ?? ''}`}</div>
  ),
}));

import { useLayoutStore } from '@/store/layout';
import { DelegateRow } from '../DelegateRow';

const ARGS = { task: 'Review the diff for races', role: 'review' };
const RESULT = JSON.stringify({ taskId: 'task_kid', childChatId: 'kid', title: 'Task: Review', status: 'running' });

const workspaceTabs = () => useLayoutStore.getState().run?.panes.flatMap((pane) => pane.tabs) ?? [];

let rows = 0;
let key = '';
function row(props: { result?: unknown; isError?: boolean }, live = true) {
  const part = {
    type: 'tool-call',
    toolCallId: 'tu-1',
    toolName: 'mcp__mainframe__delegate_task',
    args: ARGS,
    argsText: JSON.stringify(ARGS),
    status: { type: 'complete' },
    ...props,
  } as unknown as ToolPart;
  const unit: TurnUnit = { key, messageId: 'm', index: 0, part };
  return (
    <TooltipProvider>
      <TranscriptScopeProvider value={{ rootThreadId: 'parent', ancestors: [], pendingToolIds: new Set(), live }}>
        <DelegateRow unit={unit} part={part} />
      </TranscriptScopeProvider>
    </TooltipProvider>
  );
}

function withChild(custom: Partial<SessionCustom> = {}, status: 'regular' | 'archived' = 'regular') {
  const kid = entry('kid', { delegation: { taskId: 'task_kid', role: 'review', status: 'running' }, ...custom });
  setSessions(entry('parent'), [{ ...kid, title: 'Race review', status }]);
}
const status = () => screen.getByTestId('chat-tool-delegate-task-card-receipt').querySelector('[data-status]')!;
const toggle = () => screen.getByTestId('chat-tool-delegate-task-card-toggle');

beforeEach(() => {
  key = `row-${++rows}`;
  result.current = undefined;
  switchToThread.mockReset();
  unarchive.mockClear();
  useLayoutStore.setState({
    layout: { top: ['chat'], topFlex: {} },
    run: null,
    sessions: new Map(),
    activeSessionId: 'parent',
  });
});

describe('the row', () => {
  it('follows the child chat: its title, its live status, and a way to open it', async () => {
    withChild({ delegation: { taskId: 'task_kid', role: 'review', status: 'waiting' } });
    render(row({ result: RESULT }));
    const card = screen.getByTestId('chat-tool-delegate-task-card');
    expect(card).toHaveTextContent('Delegated');
    expect(card).toHaveTextContent('Race review');
    expect(status()).toHaveTextContent('waiting on you');
    expect(card).toHaveAttribute('data-activity-id', 'tu-1');

    await userEvent.click(screen.getByTestId('chat-tool-delegate-task-open-task_kid'));
    // Beside the parent, in the workspace; the parent stays the conversation.
    expect(workspaceTabs()).toEqual([
      { id: 'chat-kid', kind: 'chat', title: 'Race review', chatId: 'kid', role: 'task' },
    ]);
    expect(switchToThread).not.toHaveBeenCalled();
    expect(unarchive).not.toHaveBeenCalled();
  });

  it.each([
    ['queued', 'queued', 'queued'],
    ['running', 'running', 'running'],
    ['completed', 'success', 'completed'],
    ['failed', 'failed', 'failed'],
    ['cancelled', 'stopped', 'stopped'],
    ['interrupted', 'interrupted', 'interrupted'],
  ] as const)('reads a %s task as %s', (task, shown, words) => {
    withChild({ delegation: { taskId: 'task_kid', role: 'review', status: task } });
    render(row({ result: RESULT }));
    expect(status()).toHaveAttribute('data-status', shown);
    expect(status()).toHaveTextContent(words);
  });

  it('is running again while a finished task’s chat is resumed', () => {
    withChild({ delegation: { taskId: 'task_kid', role: 'review', status: 'completed' }, isRunning: true });
    render(row({ result: RESULT }));
    expect(status()).toHaveAttribute('data-status', 'running');
  });

  it.each([
    ['still listed as running', { delegation: { taskId: 'task_kid', role: 'review', status: 'running' } }],
    ['listed as completed', { delegation: { taskId: 'task_kid', role: 'review', status: 'completed' } }],
    [
      'whose chat still winds down',
      { delegation: { taskId: 'task_kid', role: 'review', status: 'failed' }, isRunning: true },
    ],
  ] as const)('reads a task that came back failed as failed, %s', (_how, custom) => {
    result.current = { taskId: 'task_kid', chatId: 'kid', status: 'failed', body: 'Out of budget' };
    withChild(custom);
    render(row({ result: RESULT }));
    expect(status()).toHaveAttribute('data-status', 'failed');
    expect(screen.getByTestId('chat-tool-delegate-task-card').querySelector('.animate-spin')).toBeNull();
  });

  it('reads the failure a call that waited returned, with no chat in the list', async () => {
    setSessions(entry('parent'));
    const failed = {
      taskId: 'task_kid',
      childChatId: 'kid',
      status: 'failed',
      error: 'Out of budget',
      summary: 'Half done',
    };
    render(row({ result: JSON.stringify(failed) }, false));
    expect(status()).toHaveAttribute('data-status', 'failed');
    await userEvent.click(toggle());
    const body = await screen.findByTestId('stub-task-chat');
    expect(body).toHaveTextContent('Out of budget');
    expect(body).toHaveTextContent('Half done');
  });

  it('claims nothing of a launch nothing reports on any more', () => {
    setSessions(entry('parent'));
    render(row({ result: RESULT }, false));
    expect(status()).toHaveAttribute('data-status', 'unknown');
    expect(status()).toHaveTextContent('no result');
  });

  it('restores an archived child as it opens it', async () => {
    withChild({}, 'archived');
    render(row({ result: RESULT }));
    const open = screen.getByTestId('chat-tool-delegate-task-open-task_kid');
    expect(open).toHaveAccessibleName('Restore Race review and open it in the workspace');
    await userEvent.click(open);
    expect(unarchive).toHaveBeenCalledOnce();
    expect(workspaceTabs().map((tab) => tab.chatId)).toEqual(['kid']);
  });

  it('falls back to the call’s result while the child is not in the list', () => {
    setSessions(entry('parent'));
    render(row({ result: RESULT }));
    expect(screen.getByTestId('chat-tool-delegate-task-card')).toHaveTextContent('Task: Review');
    expect(status()).toHaveAttribute('data-status', 'running');
    expect(screen.queryByTestId('chat-tool-delegate-task-open-task_kid')).toBeNull();
  });
});

describe('what it opens on', () => {
  it('mounts the child’s steps only once opened', async () => {
    withChild();
    render(row({ result: RESULT }));
    expect(screen.queryByTestId('stub-task-chat')).toBeNull();
    await userEvent.click(toggle());
    expect(await screen.findByTestId('stub-task-chat')).toHaveTextContent('kid:task_kid:');
  });

  it('shows the result the parent received, in the row', async () => {
    result.current = { taskId: 'task_kid', chatId: 'kid', status: 'completed', body: 'No races found.' };
    withChild({ delegation: { taskId: 'task_kid', role: 'review', status: 'completed' } });
    render(row({ result: RESULT }));
    await userEvent.click(toggle());
    expect(await screen.findByTestId('stub-task-chat')).toHaveTextContent('kid:task_kid:No races found.');
  });

  it('shows the task until the call returns', async () => {
    setSessions(entry('parent'));
    render(row({ result: undefined }));
    await userEvent.click(toggle());
    expect(screen.getByTestId('stub-steps')).toHaveTextContent('Review the diff for races|');
  });

  it('shows why a call was refused', async () => {
    setSessions(entry('parent'));
    render(row({ result: 'Too many delegated tasks for this chat.', isError: true }));
    await userEvent.click(toggle());
    expect(screen.getByTestId('stub-steps')).toHaveTextContent('Too many delegated tasks');
    expect(screen.getByTestId('stub-steps')).toHaveAttribute('data-outcome', 'failed');
  });
});

describe('a task that waits on you', () => {
  it.each([
    ['its own request', { hasPending: true }],
    ['a request further down its task tree', { delegatedWaiting: true }],
  ])('opens itself for %s', async (_label, custom) => {
    withChild(custom);
    render(row({ result: RESULT }));
    expect(await screen.findByTestId('stub-task-chat')).toBeTruthy();
    expect(status()).toHaveAttribute('data-status', 'needs-you');
  });

  it('opens again when a request rises after you closed it', async () => {
    withChild({ hasPending: true });
    const { rerender } = render(row({ result: RESULT }));
    await screen.findByTestId('stub-task-chat');
    const card = screen.getByTestId('chat-tool-delegate-task-card');
    await userEvent.click(toggle());
    expect(card).toHaveAttribute('data-state', 'closed');
    withChild({ hasPending: false });
    act(() => rerender(row({ result: RESULT })));
    expect(card).toHaveAttribute('data-state', 'closed');
    withChild({ hasPending: true });
    act(() => rerender(row({ result: RESULT })));
    expect(card).toHaveAttribute('data-state', 'open');
  });
});
