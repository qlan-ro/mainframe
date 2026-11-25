import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ThreadMessage } from '@assistant-ui/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { controller, childMessages } = vi.hoisted(() => ({
  controller: {
    load: vi.fn(async () => undefined),
    loadEarlier: vi.fn(async () => true),
    isHistoryContext: vi.fn(() => false),
    subscribeLive: vi.fn(() => vi.fn()),
    holdActive: vi.fn(() => vi.fn()),
  },
  childMessages: { current: [] as ThreadMessage[] },
}));

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: { getOrCreate: () => controller },
}));
vi.mock('../../runtime/use-chat-thread-runtime', () => ({
  useControllerState: () => ({
    loadState: { type: 'ready' },
    historyWindow: { hasMore: true, floorItemId: 'child' },
    interactions: { permissions: {} },
    runState: { type: 'idle' },
    backgroundTasks: {},
  }),
}));
vi.mock('../../runtime/use-native-thread-messages', () => ({
  useNativeThreadMessages: () => [
    {
      id: 'parent-message',
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'task-1', messages: childMessages.current }],
    },
  ],
}));
vi.mock('../../messages/turn/transcript-scope', () => ({
  RootTranscriptScope: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTranscriptScope: () => ({ rootThreadId: '', ancestors: [], pendingToolIds: new Set() }),
}));
vi.mock('../../messages/turn/AgentSteps', () => ({
  AgentSteps: ({ messages, messageId }: { messages: readonly ThreadMessage[]; messageId: string }) => (
    <div data-testid="transcript-stub" data-message={messageId}>
      {messages.map((message) => message.id).join(',')}
    </div>
  ),
}));
vi.mock('@/components/ui/hint', () => ({ Hint: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { SubagentZone } from '../SubagentZone';

const said = (id: string) =>
  ({ id, role: 'assistant', content: [{ type: 'text', text: id }] }) as unknown as ThreadMessage;
const subagent = {
  parentChatId: 'parent',
  parentThreadId: 'parent',
  toolCallId: 'task-1',
  messageId: 'parent-message',
  title: 'worker',
};

describe('SubagentZone', () => {
  it('follows parent transcript updates and has no composer', () => {
    childMessages.current = [said('first')];
    const onClose = vi.fn();
    const view = render(<SubagentZone subagent={subagent} grow={0.5} onClose={onClose} />);
    expect(screen.getByTestId('transcript-stub')).toHaveTextContent('first');
    expect(controller.subscribeLive).toHaveBeenCalledOnce();

    childMessages.current = [said('first'), said('latest')];
    view.rerender(<SubagentZone subagent={subagent} grow={0.5} onClose={onClose} />);
    expect(screen.getByTestId('transcript-stub')).toHaveTextContent('first,latest');
    expect(screen.getByText('Subagent transcript · read-only')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close subagent transcript' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

afterEach(() => {
  controller.isHistoryContext.mockReturnValue(false);
  controller.loadEarlier.mockClear();
});

it('loads the complete subagent transcript when its row was supplied as context', async () => {
  controller.isHistoryContext.mockReturnValue(true);
  childMessages.current = [said('later-child')];
  render(<SubagentZone subagent={subagent} grow={0.5} onClose={vi.fn()} />);
  await waitFor(() => expect(controller.loadEarlier).toHaveBeenCalledWith('task-1'));
});

it('finds the message of a sub-agent opened before its call was loaded', () => {
  childMessages.current = [{ id: 'first' } as ThreadMessage];
  render(<SubagentZone subagent={{ ...subagent, messageId: undefined }} grow={0.5} onClose={vi.fn()} />);
  expect(screen.getByTestId('transcript-stub')).toHaveAttribute('data-message', 'parent-message');
});

it('loads the history for a sub-agent whose call is not in it', async () => {
  childMessages.current = [];
  render(
    <SubagentZone
      subagent={{ ...subagent, toolCallId: 'task-gone', messageId: undefined }}
      grow={0.5}
      onClose={vi.fn()}
    />,
  );
  await waitFor(() => expect(controller.loadEarlier).toHaveBeenCalledWith('task-gone'));
  expect(screen.queryByText('Not in this transcript')).toBeNull();
});
