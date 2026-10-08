/**
 * AgentMessageCard — pure props component; react-markdown renders in jsdom
 * without mocking (see ReviewCommentCard.test.tsx).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentMessageCard } from '../AgentMessageCard';

describe('AgentMessageCard', () => {
  it('names the sending chat and renders the body', () => {
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

  it('renders one section per batched task result', () => {
    render(
      <AgentMessageCard
        messageId="m2"
        parsed={{
          type: 'task-results',
          results: [
            { taskId: 't1', chatId: 'c1', status: 'completed', body: 'Done' },
            { taskId: 't2', chatId: 'c2', status: 'waiting_for_children', body: '' },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('chat-task-result-card-t1')).toHaveTextContent('Task result · completed · chat c1');
    expect(screen.getByTestId('chat-task-result-card-t1')).toHaveTextContent('Done');
    expect(screen.getByTestId('chat-task-result-card-t2')).toHaveTextContent('waiting for children');
  });
});
