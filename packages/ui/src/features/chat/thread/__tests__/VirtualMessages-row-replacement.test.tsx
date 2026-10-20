import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { VirtualMessages } from '../VirtualMessages';

const fixture = vi.hoisted(() => ({
  state: {
    thread: {
      messages: [
        { id: 'a', role: 'user' },
        { id: 'b', role: 'assistant' },
      ],
    },
  },
  listeners: new Set<() => void>(),
  initialIds: undefined as string[] | undefined,
  rendered: [] as number[],
}));

vi.mock('@assistant-ui/react', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useAuiState: (selector: (state: typeof fixture.state) => unknown) =>
      useSyncExternalStore(
        (listener) => {
          fixture.listeners.add(listener);
          return () => {
            fixture.listeners.delete(listener);
          };
        },
        () => selector(fixture.state),
      ),
    ThreadPrimitive: {
      MessageByIndex: ({ index }: { index: number }) => {
        if (index >= fixture.state.thread.messages.length) throw new Error('message index out of bounds');
        fixture.rendered.push(index);
        return <span>{fixture.state.thread.messages[index]!.id}</span>;
      },
    },
  };
});
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: string[];
    itemContent: (index: number, id: string) => React.ReactNode;
  }) => {
    fixture.initialIds ??= data;
    return (
      <div>
        {fixture.initialIds.map((id, index) => (
          <div key={id}>{itemContent(index, id)}</div>
        ))}
      </div>
    );
  },
}));
vi.mock('../transcript-scroll-context', () => ({
  useTranscriptScroll: () => ({ viewport: document.body, isFollowing: () => false }),
}));
vi.mock('../../runtime/chat-extras', () => ({
  useChatExtrasSelector: (selector: (extras: { state: { chatId: string } }) => unknown) =>
    selector({ state: { chatId: 'c' } }),
}));

it('ignores stale virtual rows when the runtime replaces a two-message transcript with one message', () => {
  const view = render(<VirtualMessages components={{ Message: () => null }} />);
  expect(screen.getByText('b')).toBeInTheDocument();
  fixture.rendered = [];
  act(() => {
    fixture.state = { thread: { messages: [{ id: 'a', role: 'user' }] } };
    fixture.listeners.forEach((listener) => listener());
  });
  expect(screen.queryByText('b')).toBeNull();
  expect(screen.getByText('a')).toBeInTheDocument();
  expect(fixture.rendered).not.toContain(1);
  view.unmount();
});
