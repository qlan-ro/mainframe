import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFindInChatStore } from '../find-in-chat-store';
import type { HistorySearchResult } from '@qlan-ro/mainframe-types';

const f = vi.hoisted(() => ({ messages: [] as object[], load: vi.fn(), search: vi.fn() }));
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (select: (state: unknown) => unknown) => select({ thread: { messages: f.messages } }),
}));
vi.mock('../../runtime/chat-extras', () => ({
  useChatExtras: () => ({
    state: { chatId: 'chat' },
    canSearchHistory: true,
    searchHistory: f.search,
    loadEarlier: f.load,
  }),
}));
vi.mock('@/features/session-panel/activity-source', () => ({ ACTIVITY_JUMP_EVENT: 'jump' }));
import { DaemonFind } from '../DaemonFind';
import { FindBar } from '../FindBar';

function result(id: string, total = 1): HistorySearchResult {
  return { total, matches: [{ containerId: id, itemId: id, occurrence: 0 }] };
}

beforeEach(() => {
  f.search.mockReset().mockResolvedValue(result('old', 57));
  f.load.mockReset();
  f.messages = [{ id: 'tail' }];
  useFindInChatStore.setState({
    isOpen: true,
    query: 'needle',
    matches: [],
    activeIndex: 0,
    daemon: false,
    serverTotal: null,
    loading: false,
    error: null,
    navigation: 0,
  });
});
afterEach(() => {
  document.querySelector('[data-mf-chat-thread]')?.remove();
});

describe('whole-transcript find', () => {
  it('shows the exact total without loading on typing, then loads once when stepping', async () => {
    const view = render(
      <>
        <FindBar />
        <DaemonFind />
      </>,
    );
    await waitFor(() => expect(useFindInChatStore.getState().serverTotal).toBe(57));
    expect(view.getByText('57/57')).toBeTruthy();
    expect(f.load).not.toHaveBeenCalled();
    f.load.mockImplementation(async () => {
      const thread = document.createElement('div');
      thread.dataset.mfChatThread = '';
      thread.dataset.mfChatId = 'chat';
      thread.innerHTML = '<div data-message-id="old" data-search-item-id="old"><div data-text-part>needle</div></div>';
      thread.querySelector('div')!.scrollIntoView = vi.fn();
      document.body.append(thread);
      return true;
    });
    fireEvent.click(view.getByTestId('thread-find-next'));
    await waitFor(() => expect(f.load).toHaveBeenCalledWith('old'));
    await waitFor(() => expect(useFindInChatStore.getState().loading).toBe(false));
    expect(f.load).toHaveBeenCalledTimes(1);
  });

  it('discards a reply for an older query when responses arrive out of order', async () => {
    let oldReply!: (value: HistorySearchResult) => void;
    f.search.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          oldReply = resolve;
        }),
    );
    render(<DaemonFind />);
    await waitFor(() => expect(f.search).toHaveBeenCalledTimes(1));
    act(() => useFindInChatStore.getState().setQuery('new query'));
    await waitFor(() => expect(useFindInChatStore.getState().serverTotal).toBe(57));
    await act(async () => oldReply(result('stale', 999)));
    expect(useFindInChatStore.getState().serverTotal).toBe(57);
    expect(useFindInChatStore.getState().matches[0]?.messageId).toBe('old');
  });

  it('refreshes on live edits and skips a page that preserves the held messages', async () => {
    const view = render(<DaemonFind />);
    await waitFor(() => expect(f.search).toHaveBeenCalledTimes(1));
    f.messages = [{ id: 'earlier' }, ...f.messages];
    view.rerender(<DaemonFind />);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(f.search).toHaveBeenCalledTimes(1);
    f.messages = [f.messages[0]!, { id: 'tail', text: 'new token' }];
    view.rerender(<DaemonFind />);
    await waitFor(() => expect(f.search).toHaveBeenCalledTimes(2));
  });
});
