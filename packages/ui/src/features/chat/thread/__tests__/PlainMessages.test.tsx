// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
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
/** The messages a folded turn draws nothing for (`use-folded-away-rows.ts`), set per test. */
const foldedAway = vi.hoisted(() => ({ ids: new Set<string>() }));
vi.mock('../use-folded-away-rows', () => ({ useFoldedAwayRows: () => foldedAway.ids }));

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

beforeEach(() => {
  vi.mocked(markFirstTranscriptShown).mockClear();
  foldedAway.ids = new Set();
});

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

  it('marks rows still to mount above the newest ones (the boot cover reads it), and clears the mark once all are in', async () => {
    render(
      <Harness messages={make(40)}>
        <PlainMessages components={components} />
      </Harness>,
    );
    const list = screen.getByTestId('chat-message-list');
    expect(list).toHaveAttribute('data-rows-pending', '');
    await waitFor(() => expect(screen.getAllByTestId('row')).toHaveLength(40));
    expect(list).not.toHaveAttribute('data-rows-pending');
    expect(list).not.toHaveAttribute('data-rows-empty');
  });

  it('says it draws nothing when every loaded message is folded away', () => {
    // Only reachable when no message carries the run's status row (it always keeps its row): here every one is queued.
    foldedAway.ids = new Set(['m0', 'm1']);
    const queued = { custom: { mainframe: { queued: true } } };
    render(
      <Harness messages={make(2).map((message) => ({ ...message, metadata: queued }))}>
        <PlainMessages components={components} />
      </Harness>,
    );
    const list = screen.getByTestId('chat-message-list');
    expect(screen.queryAllByTestId('row')).toHaveLength(0);
    expect(list).toHaveAttribute('data-rows-empty', '');
    expect(list).toHaveAttribute('data-loaded-count', '2');
  });
});

describe('a folded turn’s messages that draw nothing', () => {
  it('get no row, while the loaded count still counts them', () => {
    foldedAway.ids = new Set(['m1', 'm2']);
    render(
      <Harness messages={make(4)}>
        <PlainMessages components={components} />
      </Harness>,
    );
    expect(screen.getAllByTestId('row').map((row) => row.textContent)).toEqual(['text 0', 'text 3']);
    expect(screen.getByTestId('chat-message-list')).toHaveAttribute('data-loaded-count', '4');
  });

  it('never leave out the newest message, which carries the run’s status row', () => {
    foldedAway.ids = new Set(['m2', 'm3']);
    render(
      <Harness messages={make(4)}>
        <PlainMessages components={components} />
      </Harness>,
    );
    expect(screen.getAllByTestId('row').map((row) => row.textContent)).toEqual(['text 0', 'text 1', 'text 3']);
    expect(screen.getByTestId('status-row')).toBeInTheDocument();
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
