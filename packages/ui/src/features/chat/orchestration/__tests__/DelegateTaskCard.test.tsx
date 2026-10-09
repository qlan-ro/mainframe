import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import type { SessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { auiState, entry, setSessions, switchToThread } from './fixtures';

const { openInSplit } = vi.hoisted(() => ({ openInSplit: vi.fn(() => true) }));

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (sel: (s: typeof auiState) => unknown) => sel(auiState),
  useAui: () => ({
    threads: { switchToThread, getState: () => ({ mainThreadId: auiState.threadListItem?.id }) },
  }),
}));
vi.mock('@/features/chat/zones/open-in-split', () => ({ openInSplit }));
vi.mock('../TaskChatTranscript', () => ({
  TaskChatTranscript: ({ chatId, taskId }: { chatId: string; taskId: string }) => (
    <div data-testid="stub-task-chat">{`${chatId}:${taskId}`}</div>
  ),
}));

import { DelegateTaskCard } from '../DelegateTaskCard';

const ARGS = { task: 'Review the diff for races', role: 'review' };
const RESULT = JSON.stringify({ taskId: 'task_kid', childChatId: 'kid', title: 'Task: Review', status: 'running' });

function part(props: { result?: unknown; isError?: boolean }) {
  return {
    type: 'tool-call',
    toolCallId: 'tu-1',
    toolName: 'mcp__mainframe__delegate_task',
    args: ARGS,
    argsText: JSON.stringify(ARGS),
    status: { type: 'complete' },
    addResult: () => {},
    resume: () => {},
    ...props,
  } as unknown as ToolCallMessagePartProps;
}

function card(props: { result?: unknown; isError?: boolean }) {
  return (
    <TooltipProvider>
      <DelegateTaskCard {...part(props)} />
    </TooltipProvider>
  );
}

function withChild(custom: Partial<SessionCustom> = {}, status: 'regular' | 'archived' = 'regular') {
  const kid = entry('kid', { delegation: { taskId: 'task_kid', role: 'review', status: 'running' }, ...custom });
  setSessions(entry('parent'), [{ ...kid, title: 'Race review', status }]);
}

beforeEach(() => {
  switchToThread.mockReset();
  openInSplit.mockReset().mockReturnValue(true);
});

describe('DelegateTaskCard — header', () => {
  it('follows the child row: its title, its live status, and an open link', async () => {
    withChild({ delegation: { taskId: 'task_kid', role: 'review', status: 'waiting' } });
    render(card({ result: RESULT }));

    const shell = screen.getByTestId('chat-tool-delegate-task-card');
    expect(shell).toHaveTextContent('Delegate');
    expect(shell).toHaveTextContent('Race review');
    expect(screen.getByTestId('chat-tool-delegate-task-status')).toHaveAttribute('data-status', 'waiting');

    await userEvent.click(screen.getByTestId('chat-tool-delegate-task-open-task_kid'));
    // Opens beside the parent (the active thread, 'parent') rather than
    // replacing it outright: the split absorbs the gesture first, and
    // `switchToThread` only moves focus onto the now-visible child.
    expect(openInSplit).toHaveBeenCalledWith('parent', 'kid');
    expect(switchToThread).toHaveBeenCalledWith('kid');
  });

  it("does not replace the active thread when the split can't absorb the gesture", async () => {
    // e.g. the child is already a member of the visible split — openInSplit
    // falls through (returns false) and the card still just focuses it.
    openInSplit.mockReturnValue(false);
    withChild();
    render(card({ result: RESULT }));

    await userEvent.click(screen.getByTestId('chat-tool-delegate-task-open-task_kid'));
    expect(openInSplit).toHaveBeenCalledWith('parent', 'kid');
    expect(switchToThread).toHaveBeenCalledWith('kid');
  });

  it('offers to restore an archived child — opening it unarchives it', () => {
    withChild({}, 'archived');
    render(card({ result: RESULT }));
    expect(screen.getByTestId('chat-tool-delegate-task-open-task_kid')).toHaveAccessibleName(
      "Restore and open the task's chat beside this one",
    );
  });

  it('falls back to the result while the child row has not loaded, with the link disabled', () => {
    setSessions(entry('parent'));
    render(
      card({ result: JSON.stringify({ taskId: 'task_x', childChatId: 'x', title: 'Task: X', status: 'queued' }) }),
    );
    expect(screen.getByTestId('chat-tool-delegate-task-card')).toHaveTextContent('Task: X');
    expect(screen.getByTestId('chat-tool-delegate-task-status')).toHaveAttribute('data-status', 'queued');
    expect(screen.getByTestId('chat-tool-delegate-task-open-task_x')).toBeDisabled();
  });

  it('shows the error text and no link for a refused call', async () => {
    setSessions(entry('parent'));
    render(card({ result: 'Too many delegated tasks for this chat.', isError: true }));
    expect(screen.queryByTestId('chat-tool-delegate-task-status')).toBeNull();
    await userEvent.click(screen.getByTestId('chat-tool-delegate-task-trigger'));
    expect(screen.getByTestId('chat-tool-delegate-task-error')).toHaveTextContent('Too many delegated tasks');
  });
});

describe('DelegateTaskCard — the child chat inside the card', () => {
  it("mounts the child's transcript only once expanded", async () => {
    withChild();
    render(card({ result: RESULT }));
    expect(screen.queryByTestId('stub-task-chat')).toBeNull();

    await userEvent.click(screen.getByTestId('chat-tool-delegate-task-trigger'));
    expect(await screen.findByTestId('stub-task-chat')).toHaveTextContent('kid:task_kid');
  });

  it('shows the task prompt until the call returns', async () => {
    setSessions(entry('parent'));
    render(card({ result: undefined }));
    await userEvent.click(screen.getByTestId('chat-tool-delegate-task-trigger'));
    expect(screen.getByTestId('chat-tool-delegate-task-prompt')).toHaveTextContent('Review the diff for races');
    expect(screen.queryByTestId('stub-task-chat')).toBeNull();
  });

  it.each([
    ['its own gate', { hasPending: true }],
    ['a gate further down its task tree', { delegatedWaiting: true }],
  ])('opens itself while the child waits on %s', async (_label, custom) => {
    withChild(custom);
    render(card({ result: RESULT }));
    expect(await screen.findByTestId('stub-task-chat')).toBeTruthy();
    expect(screen.getByTestId('chat-tool-delegate-task-status')).toHaveAttribute('data-status', 'waiting');
  });

  it('opens again when a gate rises after the user collapsed it', async () => {
    withChild({ hasPending: true });
    const { rerender } = render(card({ result: RESULT }));
    await screen.findByTestId('stub-task-chat');
    await userEvent.click(screen.getByTestId('chat-tool-delegate-task-trigger'));
    expect(screen.getByTestId('chat-tool-delegate-task-card')).toHaveAttribute('data-state', 'closed');

    withChild({ hasPending: false });
    rerender(card({ result: RESULT }));
    expect(screen.getByTestId('chat-tool-delegate-task-card')).toHaveAttribute('data-state', 'closed');
    withChild({ hasPending: true });
    rerender(card({ result: RESULT }));
    expect(screen.getByTestId('chat-tool-delegate-task-card')).toHaveAttribute('data-state', 'open');
  });
});
