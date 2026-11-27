// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { FIRST_ROWS } from '../use-tail-first-rows';
import { TranscriptScrollProvider } from '../transcript-scroll-context';

vi.mock('../TimeMarker', () => ({ TimeMarker: ({ index }: { index: number }) => <i data-time-marker={index} /> }));
vi.mock('../TurnStatusRow', () => ({ TurnStatusRow: () => <b data-testid="status-row" /> }));
vi.mock('../VirtualMessages', () => ({ VirtualMessages: () => <div data-testid="virtual-list" /> }));
vi.mock('@/lib/after-first-paint', () => ({ markFirstTranscriptShown: vi.fn() }));

import { PlainMessages } from '../PlainMessages';
import { TranscriptList } from '../TranscriptList';
import { markFirstTranscriptShown } from '@/lib/after-first-paint';

const Row = () => (
  <MessagePrimitive.Root data-testid="row">
    <MessagePrimitive.Parts />
  </MessagePrimitive.Root>
);
const components = { UserMessage: Row, AssistantMessage: Row, SystemMessage: Row };

const make = (count: number): ThreadMessageLike[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `text ${i}`,
  }));

function Harness({ messages, children }: { messages: ThreadMessageLike[]; children: ReactNode }) {
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    convertMessage: (message) => message,
    isRunning: false,
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>{children}</ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

const controller = {
  owned: true,
  viewportElement: { current: null },
  isFollowing: () => true,
  beginInteraction: () => () => undefined,
};

beforeEach(() => vi.mocked(markFirstTranscriptShown).mockClear());

describe('PlainMessages', () => {
  it('draws every row of a short window, in order, with its index from the list', () => {
    render(
      <Harness messages={make(4)}>
        <PlainMessages components={components} />
      </Harness>,
    );
    expect(screen.getAllByTestId('row').map((row) => row.textContent)).toEqual([
      'text 0',
      'text 1',
      'text 2',
      'text 3',
    ]);
    expect([...document.querySelectorAll('[data-time-marker]')].map((m) => m.getAttribute('data-time-marker'))).toEqual(
      ['0', '1', '2', '3'],
    );
    const list = screen.getByTestId('chat-message-list');
    expect(list).toHaveAttribute('data-loaded-count', '4');
    expect(list).toHaveAttribute('data-loaded-user-count', '2');
    expect(list).toHaveAttribute('data-virtualized', 'false');
    expect(markFirstTranscriptShown).toHaveBeenCalledTimes(1);
  });

  it('mounts only the newest rows of a long window at the first commit', () => {
    render(
      <Harness messages={make(40)}>
        <PlainMessages components={components} />
      </Harness>,
    );
    const rows = screen.getAllByTestId('row');
    expect(rows).toHaveLength(FIRST_ROWS);
    expect(rows[rows.length - 1]).toHaveTextContent('text 39');
    expect(screen.getByTestId('chat-message-list')).toHaveAttribute('data-loaded-count', '40');
  });
});

describe('TranscriptList', () => {
  it('draws plain rows under the scroll owner and today’s virtualized list otherwise', () => {
    const { unmount } = render(
      <Harness messages={make(2)}>
        <TranscriptScrollProvider value={controller}>
          <TranscriptList components={components} />
        </TranscriptScrollProvider>
      </Harness>,
    );
    expect(screen.queryByTestId('virtual-list')).toBeNull();
    expect(screen.getByTestId('chat-message-list')).toBeInTheDocument();
    unmount();
    render(
      <Harness messages={make(2)}>
        <TranscriptList components={components} />
      </Harness>,
    );
    expect(screen.getByTestId('virtual-list')).toBeInTheDocument();
  });
});
