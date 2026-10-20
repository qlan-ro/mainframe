import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EarlierMessages, HISTORY_PREPEND_EVENT } from '../EarlierMessages';
import { TranscriptScrollProvider } from '../transcript-scroll-context';

const f = vi.hoisted(() => ({ first: 'old', load: vi.fn() }));
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (select: (state: unknown) => unknown) => select({ thread: { messages: [{ id: f.first }] } }),
}));
vi.mock('../../runtime/chat-extras', () => ({
  useChatExtras: () => ({
    state: { chatId: 'chat', historyWindow: { hasMore: true, loading: false } },
    loadEarlier: f.load,
  }),
}));

let viewport: HTMLDivElement;
beforeEach(() => {
  f.first = 'old';
  f.load.mockReset().mockResolvedValue(true);
  viewport = document.createElement('div');
  viewport.style.overflowAnchor = 'none';
  viewport.innerHTML = '<div data-message-id="old">Reading anchor</div>';
  Object.defineProperties(viewport, {
    clientHeight: { value: 500 },
    scrollHeight: { value: 2000 },
    scrollTop: { value: 100, writable: true },
  });
  document.body.append(viewport);
});
afterEach(() => viewport.remove());

function harness(pinned = false) {
  const release = vi.fn();
  const beginInteraction = vi.fn(() => release);
  const controller = { viewportElement: { current: viewport }, isFollowing: () => pinned, beginInteraction };
  const view = render(
    <TranscriptScrollProvider value={controller}>
      <EarlierMessages />
    </TranscriptScrollProvider>,
  );
  return {
    ...view,
    release,
    prepend: () => {
      f.first = 'earlier';
      view.rerender(
        <TranscriptScrollProvider value={controller}>
          <EarlierMessages />
        </TranscriptScrollProvider>,
      );
    },
  };
}

it('keeps the reading anchor in place with native anchoring disabled', () => {
  let top = 20;
  viewport.querySelector<HTMLElement>('[data-message-id]')!.getBoundingClientRect = () =>
    ({ top, bottom: top + 40 }) as DOMRect;
  const view = harness();
  act(() => window.dispatchEvent(new CustomEvent(HISTORY_PREPEND_EVENT, { detail: 'chat' })));
  top = 320;
  view.prepend();
  expect(viewport.scrollTop).toBe(400);
  expect(view.release).toHaveBeenCalledTimes(1);
});

it('keeps the bottom pin after an explicit page load', () => {
  const view = harness(true);
  act(() => window.dispatchEvent(new CustomEvent(HISTORY_PREPEND_EVENT, { detail: 'chat' })));
  view.prepend();
  expect(viewport.scrollTop).toBe(viewport.scrollHeight);
});

it('loads once per upward gesture and ignores content clicks and programmatic scrolling', () => {
  const view = harness();
  fireEvent.pointerDown(viewport.querySelector('[data-message-id]')!);
  fireEvent.scroll(viewport);
  expect(f.load).not.toHaveBeenCalled();
  fireEvent.wheel(viewport, { deltaY: -100 });
  fireEvent.scroll(viewport);
  expect(f.load).toHaveBeenCalledTimes(1);
  fireEvent.click(view.getByTestId('chat-load-earlier'));
  expect(f.load).toHaveBeenCalledTimes(2);
});
