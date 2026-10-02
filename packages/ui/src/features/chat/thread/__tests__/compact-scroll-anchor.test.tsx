import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useThreadBottomPin } from '../use-thread-bottom-pin';
import { useCompactScrollAnchor } from '../../messages/compact/use-compact-scroll-anchor';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('suspends pending bottom pin work during disclosure and resumes prior following', () => {
  let resize: () => void = () => {};
  let frame: FrameRequestCallback = () => {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  const cancel = vi.fn();
  vi.stubGlobal('cancelAnimationFrame', cancel);
  const viewport = document.createElement('div');
  Object.defineProperties(viewport, { clientHeight: { value: 100 }, scrollHeight: { value: 1000 } });
  viewport.scrollTop = 900;
  const { result } = renderHook(() => useThreadBottomPin('compact'));
  act(() => {
    result.current.viewportRef(viewport);
    result.current.contentRef(document.createElement('div'));
    resize();
  });
  const release = result.current.beginInteraction();
  viewport.scrollTop = 500;
  viewport.dispatchEvent(new Event('scroll'));
  act(() => frame(0));
  expect(cancel).toHaveBeenCalledWith(1);
  expect(viewport.scrollTop).toBe(500);
  release();
  act(() => {
    resize();
    frame(0);
  });
  expect(viewport.scrollTop).toBe(1000);
});
it('restores the outer row offset inside the nearest scrolling detail area', () => {
  vi.useFakeTimers();
  const viewport = document.createElement('div');
  const row = document.createElement('div');
  viewport.style.overflowY = 'auto';
  viewport.append(row);
  document.body.append(viewport);
  Object.defineProperties(viewport, { clientHeight: { value: 100 }, scrollHeight: { value: 1000 } });
  viewport.scrollTop = 300;
  let top = 50;
  vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => ({ top }) as DOMRect);
  const { result, rerender, unmount } = renderHook(({ open }) => useCompactScrollAnchor(open), {
    initialProps: { open: false },
  });
  result.current.rowRef.current = row;
  act(() => result.current.beforeToggle());
  top = 80;
  rerender({ open: true });
  expect(viewport.scrollTop).toBe(330);
  unmount();
  viewport.remove();
});
