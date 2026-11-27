// @vitest-environment jsdom
/**
 * Opening a transcript: the pin writes the tail offset inside the resize
 * callback, so a fresh mount (or a session switch) paints at the tail while
 * the virtualized list mounts and measures its rows.
 *
 * What jsdom can't show: it has no layout, no paint and no ResizeObserver, so
 * these tests call the observer's callback by hand and assert that the offset
 * is already written when the callback returns, with no animation frame run.
 * In a browser that callback runs after layout and before paint. Whether the
 * first painted frame really is at the tail with react-virtuoso's own
 * measuring is measured in the transcript list rig (P5), not here.
 */
import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';

import { useThreadBottomPin } from '../use-thread-bottom-pin';
import { RecordingResizeObserver, createViewport, flushFrame, installPinDoubles } from './pin-viewport-fixture';

installPinDoubles();

/** One resize callback, as the browser delivers it before paint; no frame runs. */
function resizeBeforePaint(viewport: ReturnType<typeof createViewport>, height: number) {
  viewport.resize(height);
  const observer = RecordingResizeObserver.instances[RecordingResizeObserver.instances.length - 1];
  if (!observer) throw new Error('ResizeObserver was not created');
  observer.callback([], observer);
}

/** Frames pass with no resize: the list has settled. */
function settle() {
  for (let i = 0; i < 3; i++) flushFrame();
}

function mountEmpty(threadId = 'chat-1') {
  const viewport = createViewport();
  // Before the list mounts the viewport holds no rows: nothing to scroll.
  viewport.resize(100);
  const hook = renderHook(({ id }) => useThreadBottomPin(id), { initialProps: { id: threadId } });
  act(() => {
    hook.result.current.viewportRef(viewport.element);
    hook.result.current.contentRef(document.createElement('div'));
  });
  return { viewport, ...hook };
}

it('is at the tail before the first frame paints when the list mounts its rows', () => {
  const { viewport } = mountEmpty();
  expect(viewport.element.scrollTop).toBe(0);

  // The virtualizer mounts with estimated row heights, then measures them taller.
  act(() => resizeBeforePaint(viewport, 40_000));
  expect(viewport.element.scrollTop).toBe(39_900);
  act(() => resizeBeforePaint(viewport, 45_000));
  expect(viewport.element.scrollTop).toBe(44_900);
});

it('follows a frame late again once the list stops resizing', () => {
  const { viewport } = mountEmpty();
  act(() => resizeBeforePaint(viewport, 40_000));
  act(settle);

  act(() => resizeBeforePaint(viewport, 41_000));
  expect(viewport.element.scrollTop).toBe(39_900);
  act(flushFrame);
  expect(viewport.element.scrollTop).toBe(40_900);
});

it('stops jumping before paint at the reader’s first scroll input', () => {
  const { viewport } = mountEmpty();
  act(() => resizeBeforePaint(viewport, 40_000));

  act(() => {
    viewport.element.dispatchEvent(new Event('wheel'));
    resizeBeforePaint(viewport, 41_000);
  });
  expect(viewport.element.scrollTop).toBe(39_900);
});

it('leaves a reader who scrolled up during the opening where they are', () => {
  const { viewport } = mountEmpty();
  act(() => resizeBeforePaint(viewport, 40_000));

  act(() => {
    viewport.element.dispatchEvent(new Event('wheel'));
    viewport.scrollTo(25_000);
    resizeBeforePaint(viewport, 45_000);
    flushFrame();
  });
  expect(viewport.element.scrollTop).toBe(25_000);
});

it('stops jumping before paint once a fold or prepend takes the lock', () => {
  const { viewport, result } = mountEmpty();
  act(() => resizeBeforePaint(viewport, 40_000));

  act(() => {
    const release = result.current.beginInteraction();
    release();
    resizeBeforePaint(viewport, 41_000);
  });
  expect(viewport.element.scrollTop).toBe(39_900);
});

it('opens the next session at the tail before paint after a switch', () => {
  const { viewport, rerender } = mountEmpty();
  act(() => resizeBeforePaint(viewport, 40_000));
  act(settle);

  act(() => {
    rerender({ id: 'chat-2' });
    resizeBeforePaint(viewport, 8_000);
    resizeBeforePaint(viewport, 9_000);
  });
  expect(viewport.element.scrollTop).toBe(8_900);
});
