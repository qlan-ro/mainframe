/** "Quote in reply" (C14): the whole message, as a block that says where it is from. */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { useComposerSegments } from '../../composer/segments/segment-store';
import { quoteSource, selectedMessageId } from '../../thread/quote-source';
import { TurnFixture, assistant, bash, text, tool, user } from '../turn/__tests__/fixtures';

vi.mock('../AssistantForkAction', () => ({ AssistantForkAction: () => null }));
vi.mock('../../runtime/use-active-thread-id', () => ({ useActiveThreadId: () => 'thread-1' }));
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: vi.fn().mockResolvedValue([]),
  readBackgroundTaskOutput: vi.fn(),
}));

const messages = [
  user('What broke?', 'u1'),
  assistant([bash('b', 'ls'), text('Let me look.')], 'a1'),
  assistant([bash('c', 'pwd'), text('The reset broke.')], 'a2'),
];
const liveQuote = () => useComposerSegments.getState().byThread['thread-1']?.liveQuote;

beforeEach(() => useComposerSegments.setState({ byThread: {} }));

async function quote(index: number): Promise<void> {
  fireEvent.keyDown(screen.getAllByTestId('chat-message-more')[index]!, { key: 'Enter' });
  await userEvent.click(await screen.findByTestId('chat-message-quote'));
}

it('says which reply it is from, and quotes the turn’s whole answer', async () => {
  render(<TurnFixture rootId="quote-reply" messages={messages} />);
  await quote(1);
  expect(liveQuote()).toMatchObject({ text: 'The reset broke.', source: quoteSource(messages[2]!) });
  expect(liveQuote()!.source).toMatch(/^From the reply/);
  expect(liveQuote()!.source).toMatch(/\d/);
});

it('says when it is the viewer’s own message', async () => {
  render(<TurnFixture rootId="quote-own" messages={messages} />);
  await quote(0);
  expect(liveQuote()).toMatchObject({ text: 'What broke?', source: quoteSource(messages[0]!) });
  expect(liveQuote()!.source).toMatch(/^From your message/);
});

/** The message a selection that starts in `node` is in, as the toolbar finds it. */
const sourceOf = (node: Node | null) => {
  const id = selectedMessageId({ anchorNode: node } as Selection);
  return messages.concat(nested).find((message) => message.id === id)?.id;
};
const inner = assistant([bash('i', 'git diff'), text('Nothing else.')], 'inner');
const nested = [
  user('Go', 'n1'),
  assistant(
    [
      tool({
        toolCallId: 'agent',
        toolName: 'Task',
        args: { subagent_type: 'reviewer', prompt: 'Look' },
        result: 'Done.',
        messages: [user('Look', 'p'), inner],
      }),
      text('All of it.'),
    ],
    'n2',
  ),
];

it('a selection in the folded part of a turn is of the message its step is in', () => {
  render(<TurnFixture rootId="quote-folded" messages={messages} />);
  expect(sourceOf(screen.getByText('The reset broke.').firstChild)).toBe('a2');
  expect(screen.queryByText('Let me look.')).toBeNull();
  fireEvent.click(screen.getByTestId(/^chat-work-toggle-/));
  expect(sourceOf(screen.getByText('Let me look.').firstChild)).toBe('a1');
  expect(sourceOf(screen.getByTestId('chat-row-c'))).toBe('a2');
  // The turn's own row says which message it opens.
  expect(sourceOf(screen.getByTestId(/^chat-work-header-/))).toBe('a1');
});

it('a selection in an agent’s step or prompt is of the message that started it', () => {
  render(<TurnFixture rootId="quote-agent" messages={nested} />);
  fireEvent.click(screen.getByTestId(/^chat-work-toggle-/));
  fireEvent.click(screen.getByTestId('chat-row-agent-toggle'));
  expect(sourceOf(screen.getByTestId('chat-row-i'))).toBe('n2');
  expect(sourceOf(screen.getByTestId('chat-agent-prompt'))).toBe('n2');
  expect(sourceOf(screen.getByTestId('chat-agent-result'))).toBe('n2');
});
