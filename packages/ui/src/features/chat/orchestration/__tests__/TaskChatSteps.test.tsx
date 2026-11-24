import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { ThreadMessage } from '@assistant-ui/react';
import type { PermissionOption } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ChatPermissionEntry } from '../../controller/chat-thread-state';
import type { TaskChatView } from '../use-task-chat';

const view = vi.fn<() => TaskChatView>();
vi.mock('../use-task-chat', () => ({ useTaskChat: () => view() }));
vi.mock('../../messages/turn/AgentSteps', () => ({
  AgentSteps: (props: { messages: readonly ThreadMessage[]; before?: ReactNode; after?: ReactNode }) => (
    <>
      {props.before}
      <div data-testid="stub-steps">{props.messages.map((m) => m.id).join(',')}</div>
      {props.after}
    </>
  ),
}));

import { TaskChatSteps } from '../TaskChatSteps';

const reply = vi.fn<TaskChatView['reply']>(async () => {});
const OPTIONS: PermissionOption[] = [
  { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
];
const GATE: ChatPermissionEntry = {
  requestId: 'r1',
  askedAt: 1,
  request: { requestId: 'r1', toolName: 'Bash', toolUseId: 'tu1', input: { command: 'ls' }, suggestions: [] },
  options: OPTIONS,
};

function show(overrides: Partial<TaskChatView>, onOpen?: () => void) {
  view.mockReturnValue({
    messages: [],
    hiddenCount: 0,
    loadState: { type: 'ready' },
    gate: undefined,
    reply,
    adapterId: 'claude',
    ...overrides,
  });
  render(
    <TooltipProvider>
      <TaskChatSteps chatId="kid" taskId="task_kid" messageId="m-parent" toolCallId="tu-1" onOpen={onOpen} />
    </TooltipProvider>,
  );
}
const messages = (...ids: string[]) => ids.map((id) => ({ id })) as unknown as ThreadMessage[];

beforeEach(() => {
  view.mockReset();
  reply.mockClear();
});

describe('TaskChatSteps', () => {
  it.each([
    [{ type: 'loading' } as const, "Loading the task's chat…"],
    [{ type: 'error', error: new Error('boom') } as const, "Couldn't load the task's chat."],
  ])('says why there are no steps yet (%o)', (loadState, text) => {
    show({ loadState });
    expect(screen.getByTestId('chat-tool-delegate-task-empty-task_kid')).toHaveTextContent(text);
  });

  it('shows the latest messages and opens the full chat for the rest', async () => {
    const onOpen = vi.fn();
    show({ messages: messages('m21', 'm22'), hiddenCount: 21 }, onOpen);
    expect(screen.getByTestId('stub-steps')).toHaveTextContent('m21,m22');
    expect(screen.getByTestId('chat-tool-delegate-task-transcript-task_kid')).toHaveTextContent('21 earlier messages');
    await userEvent.click(screen.getByTestId('chat-tool-delegate-task-open-full-task_kid'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('says nothing about earlier messages when they all fit', () => {
    show({ messages: messages('m1') });
    expect(screen.queryByTestId('chat-tool-delegate-task-open-full-task_kid')).toBeNull();
  });

  it("answers the child's request with the main thread's gate card", async () => {
    show({ gate: GATE });
    const slot = screen.getByTestId('chat-tool-delegate-task-gate-task_kid');
    expect(slot.querySelector('[data-testid="chat-permission-gate"]')).toBeTruthy();
    await userEvent.click(screen.getByTestId('chat-permission-option-reject-once'));
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0]![1]).toBe('reject-once');
  });
});
