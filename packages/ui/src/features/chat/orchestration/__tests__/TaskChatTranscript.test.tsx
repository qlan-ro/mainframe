import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ThreadMessage } from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { TaskChatView } from '../use-task-chat';

const view = vi.fn<() => TaskChatView>();
vi.mock('../use-task-chat', () => ({ useTaskChat: () => view() }));
vi.mock('../../tools/cards/SubagentTranscript', () => ({
  SubagentTranscript: ({ messages }: { messages: readonly ThreadMessage[] }) => (
    <div data-testid="stub-transcript">{messages.map((m) => m.id).join(',')}</div>
  ),
}));

import { TaskChatTranscript } from '../TaskChatTranscript';

function viewWith(overrides: Partial<TaskChatView>): TaskChatView {
  return {
    messages: [],
    hiddenCount: 0,
    loadState: { type: 'ready' },
    ...overrides,
  };
}

function renderBody(onOpen?: () => void) {
  return render(
    <TooltipProvider>
      <TaskChatTranscript chatId="kid" taskId="task_kid" messageId="m-parent" toolCallId="tu-1" onOpen={onOpen} />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  view.mockReset();
});

describe('TaskChatTranscript', () => {
  it.each([
    [{ type: 'loading' } as const, "Loading the task's chat…"],
    [{ type: 'ready' } as const, 'No messages yet.'],
    [{ type: 'error', error: new Error('boom') } as const, "Couldn't load the task's chat."],
  ])('reads the empty transcript by load state (%o)', (loadState, text) => {
    view.mockReturnValue(viewWith({ loadState }));
    renderBody();
    expect(screen.getByTestId('chat-tool-delegate-task-empty-task_kid')).toHaveTextContent(text);
  });

  it('renders the bounded transcript and opens the full chat for the rest', async () => {
    const onOpen = vi.fn();
    const messages = [{ id: 'm21' }, { id: 'm22' }] as unknown as ThreadMessage[];
    view.mockReturnValue(viewWith({ messages, hiddenCount: 21 }));
    renderBody(onOpen);

    expect(screen.getByTestId('stub-transcript')).toHaveTextContent('m21,m22');
    expect(screen.getByTestId('chat-tool-delegate-task-transcript-task_kid')).toHaveTextContent('21 earlier messages');
    await userEvent.click(screen.getByTestId('chat-tool-delegate-task-open-full-task_kid'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows no earlier-messages row when the whole transcript fits', () => {
    view.mockReturnValue(viewWith({ messages: [{ id: 'm1' }] as unknown as ThreadMessage[] }));
    renderBody();
    expect(screen.queryByTestId('chat-tool-delegate-task-open-full-task_kid')).toBeNull();
  });

  it('shows no gate card: a child’s request is answered above the parent’s composer', () => {
    view.mockReturnValue(viewWith({}));
    renderBody();

    expect(screen.queryByTestId('chat-permission-gate')).toBeNull();
    expect(screen.queryByTestId('chat-tool-delegate-task-gate-task_kid')).toBeNull();
  });
});
