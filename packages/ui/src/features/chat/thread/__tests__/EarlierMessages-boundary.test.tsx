// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EarlierMessages, LOADING_MIN_VISIBLE_MS } from '../EarlierMessages';
import { TranscriptScrollProvider, type TranscriptScrollController } from '../transcript-scroll-context';

const f = vi.hoisted(() => ({
  hasMore: true,
  loading: false,
  error: undefined as string | undefined,
  chatId: 'chat',
  listeners: new Set<() => void>(),
  version: 0,
}));
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (select: (state: unknown) => unknown) => select({ thread: { messages: [{ id: 'first' }] } }),
}));
vi.mock('../../runtime/chat-extras', () => ({
  useChatExtras: () => ({
    state: { chatId: f.chatId, historyWindow: { hasMore: f.hasMore, loading: f.loading, error: f.error } },
    loadEarlier: vi.fn(),
  }),
}));

const viewport = document.createElement('div');
const owned: TranscriptScrollController = {
  owned: true,
  viewportElement: { current: viewport },
  isFollowing: () => false,
  beginInteraction: () => () => undefined,
};
const today: TranscriptScrollController = { ...owned, owned: undefined };

function view(controller: TranscriptScrollController) {
  const ui = () => (
    <TranscriptScrollProvider value={controller}>
      <EarlierMessages />
    </TranscriptScrollProvider>
  );
  const rendered = render(ui());
  return { ...rendered, update: () => rendered.rerender(ui()) };
}
const state = () => screen.getByTestId('chat-history-boundary').getAttribute('data-state');

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(f, { hasMore: true, loading: false, error: undefined, chatId: 'chat' });
});
afterEach(() => vi.useRealTimers());

describe('the top of the plain list', () => {
  it('shows a cue that more is above while older messages exist and nothing loads', () => {
    view(owned);
    expect(state()).toBe('more');
    expect(screen.getByTestId('chat-load-earlier')).toBeVisible();
    expect(screen.queryByTestId('chat-history-spinner')).toBeNull();
  });

  it('shows a spinner with the text while an older page loads', () => {
    f.loading = true;
    view(owned);
    expect(state()).toBe('loading');
    expect(screen.getByTestId('chat-history-spinner')).toBeInTheDocument();
    expect(screen.getByText('Loading earlier messages')).toBeVisible();
  });

  it('says where the conversation begins when nothing is above', () => {
    f.hasMore = false;
    view(owned);
    expect(state()).toBe('start');
    expect(screen.getByText('Beginning of conversation')).toBeVisible();
  });

  it('holds the spinner for the minimum time so a fast load does not flicker', () => {
    f.loading = true;
    const rendered = view(owned);
    act(() => void vi.advanceTimersByTime(100));
    f.loading = false;
    rendered.update();
    expect(state()).toBe('loading');
    act(() => void vi.advanceTimersByTime(LOADING_MIN_VISIBLE_MS - 101));
    expect(state()).toBe('loading');
    act(() => void vi.advanceTimersByTime(2));
    expect(state()).toBe('more');
  });

  it('does not hold the spinner on a chat switch', () => {
    f.loading = true;
    const rendered = view(owned);
    expect(state()).toBe('loading');
    f.loading = false;
    f.chatId = 'other';
    rendered.update();
    expect(state()).toBe('more');
  });

  it('keeps the same height in every state, so it never moves the rows below it', () => {
    const classes = ['more', 'loading', 'start'].map((name) => {
      f.hasMore = name === 'more';
      f.loading = name === 'loading';
      const { unmount } = view(owned);
      const className = screen.getByTestId('chat-history-boundary').className;
      unmount();
      return className;
    });
    expect(new Set(classes).size).toBe(1);
    expect(classes[0]).toContain('h-12');
  });
});

describe('today’s boundary row', () => {
  it('is unchanged with the setting off: text while loading, no spinner, no state attribute', () => {
    f.loading = true;
    view(today);
    expect(screen.getByText('Loading earlier messages...')).toBeVisible();
    expect(screen.queryByTestId('chat-history-spinner')).toBeNull();
    expect(screen.getByTestId('chat-history-boundary')).not.toHaveAttribute('data-state');
  });
});
