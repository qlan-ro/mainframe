/**
 * AgentMessageCard — react-markdown renders in jsdom without mocking (see
 * ReviewCommentCard.test.tsx); only the chat-title lookup, which reads the aui
 * thread list, is stubbed.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AgentMessageCard } from '../AgentMessageCard';

const TITLES: Record<string, string> = { parent_1: 'Fix the login flow', c1: 'Review PR 12853' };

vi.mock('../../orchestration/use-session-items', () => ({
  useChatTitle: (chatId: string) => TITLES[chatId],
}));

describe('AgentMessageCard', () => {
  it('names the sending chat by its id while it has no known title, and renders the body', () => {
    render(
      <AgentMessageCard
        messageId="m1"
        parsed={{ type: 'agent-message', message: { fromChatId: 'chat_1', kind: 'launch', body: 'Do **this**' } }}
      />,
    );
    const card = screen.getByTestId('chat-agent-message-card-m1');
    expect(card).toHaveTextContent('Started by chat chat_1');
    expect(screen.getByText('this').tagName).toBe('STRONG');
  });

  it('names the sending chat by its title when one is known', () => {
    render(
      <AgentMessageCard
        messageId="m4"
        parsed={{ type: 'agent-message', message: { fromChatId: 'parent_1', kind: 'task', body: 'Review it' } }}
      />,
    );
    const card = screen.getByTestId('chat-agent-message-card-m4');
    expect(card).toHaveTextContent('Task from Fix the login flow');
    expect(card).not.toHaveTextContent('parent_1');
  });

  it('is full width rather than end-aligned like the user bubble', () => {
    render(
      <AgentMessageCard
        messageId="m5"
        parsed={{ type: 'agent-message', message: { fromChatId: 'parent_1', kind: 'send', body: 'Hi' } }}
      />,
    );
    const card = screen.getByTestId('chat-agent-message-card-m5');
    expect(card).toHaveClass('w-full');
    expect(card).not.toHaveClass('self-end');
  });

  it('renders a dropped-send notice without attributing it to a sender', () => {
    render(
      <AgentMessageCard
        messageId="m3"
        parsed={{
          type: 'agent-message',
          message: { fromChatId: 'chat_2', kind: 'dropped', body: 'Your queued message to chat_2 was not delivered.' },
        }}
      />,
    );
    const card = screen.getByTestId('chat-agent-message-card-m3');
    expect(card).toHaveTextContent('Message not delivered');
    expect(card).toHaveTextContent('Your queued message to chat_2 was not delivered.');
    // Unlike the other kinds, the header never attributes the notice to
    // `fromChatId` as a speaker (it's the target chat it was headed to).
    expect(card.querySelector('.font-mono')).toBeNull();
  });

  it('keeps each task result whose row is not loaded as a line that opens on it', () => {
    render(
      <TooltipProvider>
        <AgentMessageCard
          messageId="m2"
          parsed={{
            type: 'task-results',
            results: [
              { taskId: 't1', chatId: 'c1', status: 'completed', body: 'Done **well**' },
              { taskId: 't2', chatId: 'c2', status: 'cancelled', body: '' },
            ],
          }}
        />
      </TooltipProvider>,
    );
    const first = screen.getByTestId('chat-task-result-t1');
    expect(first).toHaveTextContent('Task result Review PR 12853·completed');
    expect(screen.queryByText('well')).toBeNull();
    fireEvent.click(first);
    expect(screen.getByText('well').tagName).toBe('STRONG');
    // Stopped, never cancelled (T1c); nothing came back to open.
    expect(screen.getByTestId('chat-task-result-t2')).toHaveTextContent('c2·stopped');
    expect(screen.getByTestId('chat-task-result-t2')).toBeDisabled();
  });
});
