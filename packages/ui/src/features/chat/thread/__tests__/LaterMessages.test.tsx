// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LaterMessages } from '../LaterMessages';
import { TranscriptScrollProvider, type TranscriptScrollController } from '../transcript-scroll-context';

const f = vi.hoisted(() => ({
  detached: undefined as { hasBefore: boolean; hasAfter: boolean; loadingAfter: boolean } | undefined,
  loadLater: vi.fn(async () => true),
}));
vi.mock('../../runtime/chat-extras', () => ({
  useChatExtras: () => ({
    state: { historyWindow: { hasMore: true, loading: false, detached: f.detached } },
    loadLater: f.loadLater,
  }),
}));

const viewport = document.createElement('div');
const owned: TranscriptScrollController = {
  owned: true,
  viewportElement: { current: viewport },
  isFollowing: () => false,
  beginInteraction: () => () => undefined,
};
let left = 5000;
Object.defineProperties(viewport, {
  clientHeight: { get: () => 500 },
  scrollHeight: { get: () => 3000 },
  scrollTop: { get: () => 3000 - 500 - left, configurable: true },
});

function show() {
  return render(
    <TranscriptScrollProvider value={owned}>
      <LaterMessages />
    </TranscriptScrollProvider>,
  );
}
const state = () => screen.getByTestId('chat-later-boundary').getAttribute('data-state');

beforeEach(() => {
  f.detached = { hasBefore: true, hasAfter: true, loadingAfter: false };
  f.loadLater.mockClear();
  left = 5000;
});

describe('the bottom of a window around a jump target', () => {
  it('is absent at the live tail', () => {
    f.detached = undefined;
    show();
    expect(screen.queryByTestId('chat-later-boundary')).toBeNull();
  });

  it('offers later messages while the window ends before the chat does, and loads them on click', () => {
    show();
    expect(state()).toBe('more');
    fireEvent.click(screen.getByTestId('chat-load-later'));
    expect(f.loadLater).toHaveBeenCalledTimes(1);
  });

  it('offers the way back to the latest messages where the window reaches the end', () => {
    f.detached = { hasBefore: true, hasAfter: false, loadingAfter: false };
    show();
    expect(state()).toBe('end');
    expect(screen.getByTestId('chat-load-later')).toHaveTextContent('Back to latest');
  });

  it('shows a spinner while the next items load', () => {
    f.detached = { hasBefore: true, hasAfter: true, loadingAfter: true };
    show();
    expect(state()).toBe('loading');
    expect(screen.getByTestId('chat-later-spinner')).toBeVisible();
  });

  it('loads the next items on downward input within a viewport of the bottom, not before', () => {
    show();
    left = 2000;
    fireEvent.wheel(viewport, { deltaY: 40 });
    expect(f.loadLater).not.toHaveBeenCalled();
    left = 400;
    fireEvent.wheel(viewport, { deltaY: 40 });
    expect(f.loadLater).toHaveBeenCalledTimes(1);
  });

  it('ignores upward input and keys that do not scroll down', () => {
    show();
    left = 100;
    fireEvent.wheel(viewport, { deltaY: -40 });
    fireEvent.keyDown(viewport, { key: 'ArrowUp' });
    expect(f.loadLater).not.toHaveBeenCalled();
    act(() => void fireEvent.keyDown(viewport, { key: 'PageDown' }));
    expect(f.loadLater).toHaveBeenCalledTimes(1);
  });

  it('returns to the tail only at the very bottom of a window that reaches the end', () => {
    f.detached = { hasBefore: true, hasAfter: false, loadingAfter: false };
    show();
    left = 300;
    fireEvent.wheel(viewport, { deltaY: 40 });
    expect(f.loadLater).not.toHaveBeenCalled();
    left = 0;
    fireEvent.wheel(viewport, { deltaY: 40 });
    expect(f.loadLater).toHaveBeenCalledTimes(1);
  });
});
