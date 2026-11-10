import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { VirtualMessages } from '../VirtualMessages';
import { MessageTimestamp } from '../../messages/MessageTimestamp';

type Msg = {
  id: string;
  role: string;
  createdAt: Date;
  content: { type: string; text?: string }[];
  metadata?: unknown;
};
const fixture = vi.hoisted(() => ({
  messages: [] as unknown[],
  current: undefined as unknown,
  running: false,
  host: null as string | null,
}));
const at = new Date(2026, 10, 10, 9, 30);

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (state: unknown) => unknown) =>
    selector({ message: fixture.current, thread: { messages: fixture.messages, isRunning: fixture.running } }),
  ThreadPrimitive: {
    MessageByIndex: ({ index }: { index: number }) => {
      const message = (fixture.messages as Msg[])[index]!;
      fixture.current = message;
      return (
        <div data-testid="message" data-id={message.id}>
          <MessageTimestamp />
        </div>
      );
    },
  },
}));
vi.mock('../transcript-scroll-context', () => ({ useTranscriptScroll: () => null }));
vi.mock('../../runtime/chat-extras', () => ({
  useChatExtrasSelector: () => undefined,
  useChatExtras: () => undefined,
}));
vi.mock('../turn-status-host', () => ({ useTurnStatusHost: () => fixture.host }));
vi.mock('../TurnStatusRow', () => ({ TurnStatusRow: () => <div data-testid="chat-turn-status" /> }));

const assistant = (id: string): Msg => ({
  id,
  role: 'assistant',
  createdAt: at,
  content: [{ type: 'text', text: 'hi' }],
});
const clocks = () => screen.queryAllByTestId('chat-message-timestamp');
const view = () => render(<VirtualMessages components={{ Message: () => null }} />);

beforeEach(() => {
  fixture.messages = [assistant('a0'), assistant('a1')];
  fixture.running = false;
  fixture.host = null;
});

it('moves the anchor clock after the status row while the turn runs', () => {
  fixture.running = true;
  view();
  const anchor = screen.getAllByTestId('message').find((n) => n.dataset.id === 'a1')!;
  expect(anchor.querySelector('[data-testid="chat-message-timestamp"]')).toBeNull();
  const status = screen.getByTestId('chat-turn-status');
  const tail = clocks().find((c) => !c.closest('[data-testid="message"]'))!;
  expect(status.compareDocumentPosition(tail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(anchor.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // a0 keeps its footer clock; one clock for the anchor.
  expect(clocks()).toHaveLength(2);
});

it('keeps one clock in the anchor footer once settled', () => {
  view();
  const anchor = screen.getAllByTestId('message').find((n) => n.dataset.id === 'a1')!;
  expect(anchor.querySelector('[data-testid="chat-message-timestamp"]')).not.toBeNull();
  expect(clocks()).toHaveLength(2);
});

it('keeps the footer clock when a live group hosts the status', () => {
  fixture.running = true;
  fixture.host = 'tool-1';
  view();
  const anchor = screen.getAllByTestId('message').find((n) => n.dataset.id === 'a1')!;
  expect(anchor.querySelector('[data-testid="chat-message-timestamp"]')).not.toBeNull();
  expect(clocks()).toHaveLength(2);
});

it('shows no tail clock after a user-role anchor', () => {
  fixture.messages = [{ id: 'u1', role: 'user', createdAt: at, content: [{ type: 'text', text: 'q' }] }];
  fixture.running = true;
  view();
  expect(clocks()).toHaveLength(0);
});

it('without a provider the footer clock is unchanged', () => {
  fixture.running = true;
  fixture.messages = [assistant('a1')];
  fixture.current = fixture.messages[0];
  render(<MessageTimestamp />);
  expect(clocks()).toHaveLength(1);
});
