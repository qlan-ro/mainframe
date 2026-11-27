import { act, render } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { VirtualMessages } from '../VirtualMessages';

const fixture = vi.hoisted(() => ({ shown: vi.fn(), reveal: true }));

vi.mock('@/lib/after-first-paint', () => ({ markFirstTranscriptShown: fixture.shown }));
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (state: unknown) => unknown) =>
    selector({
      thread: {
        messages: [
          { id: 'a', role: 'user' },
          { id: 'b', role: 'assistant' },
        ],
      },
    }),
  ThreadPrimitive: { MessageByIndex: () => null },
}));
vi.mock('react-virtuoso', async () => {
  const { useEffect } = await import('react');
  return {
    Virtuoso: ({ data, itemsRendered }: { data: string[]; itemsRendered: (items: { data: string }[]) => void }) => {
      useEffect(() => {
        if (fixture.reveal) itemsRendered(data.map((id) => ({ data: id })));
      }, [data, itemsRendered]);
      return null;
    },
  };
});
vi.mock('../TurnStatusRow', () => ({ TurnStatusRow: () => null }));
vi.mock('../transcript-scroll-context', () => ({
  useTranscriptScroll: () => ({ viewport: document.body, isFollowing: () => true }),
}));
vi.mock('../../runtime/chat-extras', () => ({
  useChatExtrasSelector: (selector: (extras: { state: { chatId: string } }) => unknown) =>
    selector({ state: { chatId: 'c' } }),
}));

beforeEach(() => {
  fixture.shown.mockClear();
  fixture.reveal = true;
});

it('tells the boot gate once the list has revealed its last row', async () => {
  await act(async () => {
    render(<VirtualMessages components={{ Message: () => null }} />);
  });
  expect(fixture.shown).toHaveBeenCalled();
});

it('stays quiet while the list is still hidden', async () => {
  fixture.reveal = false;
  await act(async () => {
    render(<VirtualMessages components={{ Message: () => null }} />);
  });
  expect(fixture.shown).not.toHaveBeenCalled();
});
