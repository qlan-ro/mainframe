/**
 * MessageTimestamp — the clock shows only once the turn has content, so a
 * just-started turn doesn't render a lone time under nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let mockMessage: { createdAt?: Date; content: { type: string; text?: string }[] };

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (s: unknown) => unknown) => selector({ message: mockMessage }),
}));

import { MessageTimestamp } from '../MessageTimestamp';

const createdAt = new Date(2026, 9, 17, 7, 12);

describe('MessageTimestamp', () => {
  it('renders nothing while the message holds only the empty placeholder part', () => {
    mockMessage = { createdAt, content: [{ type: 'text', text: '' }] };
    render(<MessageTimestamp />);
    expect(screen.queryByTestId('chat-message-timestamp')).toBeNull();
  });

  it('renders the time once the message has text', () => {
    mockMessage = { createdAt, content: [{ type: 'text', text: 'Hello' }] };
    render(<MessageTimestamp />);
    expect(screen.getByTestId('chat-message-timestamp')).toBeInTheDocument();
  });

  it('renders the time when the message has only a tool call', () => {
    mockMessage = { createdAt, content: [{ type: 'tool-call' }] };
    render(<MessageTimestamp />);
    expect(screen.getByTestId('chat-message-timestamp')).toBeInTheDocument();
  });

  it('renders nothing without a createdAt', () => {
    mockMessage = { content: [{ type: 'text', text: 'Hello' }] };
    render(<MessageTimestamp />);
    expect(screen.queryByTestId('chat-message-timestamp')).toBeNull();
  });
});
