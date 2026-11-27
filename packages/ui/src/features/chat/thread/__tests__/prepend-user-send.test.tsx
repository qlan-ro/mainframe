// @vitest-environment jsdom
/**
 * A send while an older page is still settling: the real bottom pin and the
 * real prepend anchor share one viewport. The send must take the reader to the
 * bottom once and keep them there. The prepend's restore must not pull the view
 * back to the old reading anchor before the lock is released.
 */
import { act, render } from '@testing-library/react';
import { useLayoutEffect, useMemo, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({ first: 'old', floor: 'old-item' }));
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (select: (state: unknown) => unknown) => select({ thread: { messages: [{ id: f.first }] } }),
}));
vi.mock('../../runtime/chat-extras', () => ({
  useChatExtras: () => ({
    state: { chatId: 'chat', historyWindow: { hasMore: true, loading: false, floorItemId: f.floor } },
    loadEarlier: vi.fn().mockResolvedValue(true),
  }),
}));

import { emitUserSent } from '../../controller/user-sent';
import { EarlierMessages, HISTORY_PREPEND_EVENT } from '../EarlierMessages';
import { TranscriptScrollProvider } from '../transcript-scroll-context';
import { useThreadBottomPin } from '../use-thread-bottom-pin';

const CLIENT = 100;
let scrollHeight = 1_000;
let scrollTop = 900;
/** Every offset written to the viewport, in order. */
let writes: number[] = [];
/** The reading anchor's offset inside the content; a prepend moves it down. */
let anchorAt = 270;
let frames: FrameRequestCallback[] = [];

function makeViewport() {
  const viewport = document.createElement('div');
  const list = document.createElement('div');
  list.dataset.testid = 'chat-message-list';
  list.dataset.virtualized = 'true';
  const anchor = document.createElement('div');
  anchor.dataset.messageId = 'old';
  anchor.getBoundingClientRect = () => ({ top: anchorAt - scrollTop, bottom: anchorAt - scrollTop + 40 }) as DOMRect;
  list.append(anchor);
  viewport.append(list);
  Object.defineProperties(viewport, {
    clientHeight: { get: () => CLIENT },
    scrollHeight: { get: () => scrollHeight },
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, Math.min(value, scrollHeight - CLIENT));
        writes.push(scrollTop);
      },
    },
  });
  document.body.append(viewport);
  return { viewport, list };
}

/** `children` is made fresh by each render call, so a rerender reaches EarlierMessages. */
function Transcript({
  viewport,
  list,
  children,
}: {
  viewport: HTMLDivElement;
  list: HTMLDivElement;
  children: ReactNode;
}) {
  const pin = useThreadBottomPin('chat');
  const { viewportElement, beginInteraction, isFollowing, isInteracting, viewportRef, contentRef } = pin;
  const scroll = useMemo(
    () => ({ viewportElement, viewport: pin.viewport, beginInteraction, isFollowing, isInteracting }),
    [viewportElement, pin.viewport, beginInteraction, isFollowing, isInteracting],
  );
  useLayoutEffect(() => {
    viewportRef(viewport);
    contentRef(list);
  }, [viewport, list, viewportRef, contentRef]);
  return <TranscriptScrollProvider value={scroll}>{children}</TranscriptScrollProvider>;
}

const transcript = (viewport: HTMLDivElement, list: HTMLDivElement) => (
  <Transcript viewport={viewport} list={list}>
    <EarlierMessages />
  </Transcript>
);

beforeEach(() => {
  f.first = 'old';
  f.floor = 'old-item';
  scrollHeight = 1_000;
  scrollTop = 900;
  anchorAt = 270;
  writes = [];
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function flushFrames() {
  for (let i = 0; i < 8 && frames.length; i++) frames.splice(0).forEach((frame) => frame(i * 16));
}

it('jumps to the bottom once on a send during an older-page prepend, with no scroll back to the old anchor', async () => {
  const { viewport, list } = makeViewport();
  const view = render(transcript(viewport, list));
  // The reader scrolls up to read.
  act(() => {
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    viewport.scrollTop = 250;
    viewport.dispatchEvent(new Event('scroll'));
  });

  // An older page loads above: 300 px of content, the anchor held in place.
  act(() => window.dispatchEvent(new CustomEvent(HISTORY_PREPEND_EVENT, { detail: 'chat' })));
  scrollHeight = 1_300;
  anchorAt = 570;
  f.first = 'earlier';
  f.floor = 'earlier-item';
  view.rerender(transcript(viewport, list));
  act(() => frames.splice(0).forEach((frame) => frame(0)));
  expect(scrollTop).toBe(550);
  expect(view.getByTestId('chat-history-boundary')).toHaveAttribute('aria-busy', 'true');

  // The user sends while the page is still settling.
  writes = [];
  act(() => emitUserSent(['chat']));
  expect(scrollTop).toBe(1_200);

  // The virtual list keeps mutating as it measures; nothing restores the old anchor.
  await act(async () => {
    list.append(document.createElement('div'));
    await Promise.resolve();
  });
  act(flushFrames);

  expect(writes.every((top) => top === 1_200)).toBe(true);
  expect(scrollTop).toBe(1_200);
  expect(view.getByTestId('chat-history-boundary')).toHaveAttribute('aria-busy', 'false');
});
