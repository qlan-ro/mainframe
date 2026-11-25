import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { ThreadMessage } from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
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

function show(overrides: Partial<TaskChatView>, onOpen?: () => void) {
  view.mockReturnValue({
    messages: [],
    hiddenCount: 0,
    loadState: { type: 'ready' },
    pendingToolIds: new Set(),
    ...overrides,
  });
  render(
    <TooltipProvider>
      <TaskChatSteps
        chatId="kid"
        taskId="task_kid"
        messageId="m-parent"
        toolCallId="tu-1"
        outcome="going"
        onOpen={onOpen}
      />
    </TooltipProvider>,
  );
}
const messages = (...ids: string[]) => ids.map((id) => ({ id })) as unknown as ThreadMessage[];

beforeEach(() => {
  view.mockReset();
});

describe('TaskChatSteps', () => {
  it.each([
    [{ type: 'loading' } as const, "Loading the task's chat…"],
    [{ type: 'error', error: new Error('boom') } as const, "Couldn't load the task's chat."],
    [{ type: 'ready' } as const, 'No messages yet.'],
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

  it('says that the chat could not be loaded over the messages it has', () => {
    show({ messages: messages('m1'), loadState: { type: 'error', error: new Error('boom') } });
    expect(screen.getByTestId('stub-steps')).toHaveTextContent('m1');
    expect(screen.getByTestId('chat-tool-delegate-task-empty-task_kid')).toHaveTextContent("Couldn't load");
  });

  it('says nothing about earlier messages when they all fit', () => {
    show({ messages: messages('m1') });
    expect(screen.queryByTestId('chat-tool-delegate-task-open-full-task_kid')).toBeNull();
  });

  it('shows no gate card: a child’s request is answered above the parent’s composer', () => {
    show({ pendingToolIds: new Set(['tu-1']) });

    expect(screen.queryByTestId('chat-permission-gate')).toBeNull();
    expect(screen.queryByTestId('chat-tool-delegate-task-gate-task_kid')).toBeNull();
  });
});
