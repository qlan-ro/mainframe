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
  useControllerState: () => ({ loadState: { type: 'ready' }, historyWindow: { hasMore: true, floorItemId: 'child' } }),
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
vi.mock('../../messages/compact/transcript-scope', () => ({
  RootTranscriptScope: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../tools/cards/SubagentTranscript', () => ({
  SubagentTranscript: ({ messages }: { messages: readonly ThreadMessage[] }) => (
    <div data-testid="transcript-stub">{messages.map((message) => message.id).join(',')}</div>
  ),
}));
vi.mock('@/components/ui/hint', () => ({ Hint: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { SubagentZone } from '../SubagentZone';

const subagent = {
  parentChatId: 'parent',
  parentThreadId: 'parent',
  toolCallId: 'task-1',
  messageId: 'parent-message',
  title: 'worker',
};

describe('SubagentZone', () => {
  it('follows parent transcript updates and has no composer', () => {
    childMessages.current = [{ id: 'first' } as ThreadMessage];
    const onClose = vi.fn();
    const view = render(<SubagentZone subagent={subagent} grow={0.5} onClose={onClose} />);
    expect(screen.getByTestId('transcript-stub')).toHaveTextContent('first');
    expect(controller.subscribeLive).toHaveBeenCalledOnce();

    childMessages.current = [{ id: 'first' } as ThreadMessage, { id: 'latest' } as ThreadMessage];
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

it('loads the complete subagent transcript when its card was supplied as context', async () => {
  controller.isHistoryContext.mockReturnValue(true);
  childMessages.current = [{ id: 'later-child' } as ThreadMessage];
  render(<SubagentZone subagent={subagent} grow={0.5} onClose={vi.fn()} />);
  await waitFor(() => expect(controller.loadEarlier).toHaveBeenCalledWith('task-1'));
});
