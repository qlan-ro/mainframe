import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { VirtualMessages } from '../VirtualMessages';

const fixture = vi.hoisted(() => ({
  messages: [] as Array<{ id: string; role: string; metadata?: unknown }>,
}));
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (state: { thread: { messages: typeof fixture.messages } }) => unknown) =>
    selector({ thread: { messages: fixture.messages } }),
  ThreadPrimitive: {
    MessageByIndex: ({ index }: { index: number }) => <div data-testid="message">{fixture.messages[index]!.id}</div>,
  },
}));
vi.mock('../transcript-scroll-context', () => ({ useTranscriptScroll: () => null }));
vi.mock('../../runtime/chat-extras', () => ({ useChatExtrasSelector: () => undefined }));
vi.mock('../TurnStatusRow', () => ({ TurnStatusRow: () => <div data-testid="message">status</div> }));

const queued = { custom: { mainframe: { queued: true } } };

it('places the turn status row after the newest sent message, above queued prompts', () => {
  fixture.messages = [
    { id: 'u1', role: 'user' },
    { id: 'a1', role: 'assistant' },
    { id: 'q1', role: 'user', metadata: queued },
    { id: 'q2', role: 'user', metadata: queued },
  ];
  render(<VirtualMessages components={{ Message: () => null }} />);
  expect(screen.getAllByTestId('message').map((node) => node.textContent)).toEqual(['u1', 'a1', 'status', 'q1', 'q2']);
});

it('follows the user message itself before any reply exists', () => {
  fixture.messages = [{ id: 'u1', role: 'user' }];
  render(<VirtualMessages components={{ Message: () => null }} />);
  expect(screen.getAllByTestId('message').map((node) => node.textContent)).toEqual(['u1', 'status']);
});
