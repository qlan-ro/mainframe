/** An assistant message drawn on its own: only the error a turn ended on. */
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

let meta: { errorText?: string } = {};
vi.mock('@assistant-ui/react', () => ({
  MessagePrimitive: { Root: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div> },
  useAuiState: () => 'msg-1',
}));
vi.mock('../../view-model/message-meta', () => ({ useMainframeMeta: () => meta }));
vi.mock('../AssistantErrorBlock', () => ({ AssistantErrorBlock: ({ text }: { text: string }) => <div>{text}</div> }));

import { AssistantMessage } from '../AssistantMessage';

it('renders the error block, findable by its message', () => {
  meta = { errorText: 'boom' };
  render(<AssistantMessage />);
  expect(screen.getByText('boom').parentElement).toHaveAttribute('data-message-id', 'msg-1');
});

it('renders nothing for a message without an error', () => {
  meta = {};
  const { container } = render(<AssistantMessage />);
  expect(container).toBeEmptyDOMElement();
});
