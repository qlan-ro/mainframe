import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useCompactScrollAnchor } from '../../messages/compact/use-compact-scroll-anchor';
import { TranscriptScrollProvider } from '../transcript-scroll-context';

afterEach(() => vi.useRealTimers());

it.each([true, false])('anchors automatic folding only when reading history (following=%s)', (following) => {
  vi.useFakeTimers();
  const viewport = document.createElement('div');
  const row = document.createElement('div');
  Object.defineProperties(viewport, { clientHeight: { value: 100 }, scrollHeight: { value: 1000 } });
  viewport.scrollTop = 300;
  let top = 50;
  vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => ({ top }) as DOMRect);
  const release = vi.fn();
  const controller = {
    viewportElement: { current: viewport },
    isFollowing: () => following,
    beginInteraction: vi.fn(() => release),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TranscriptScrollProvider value={controller}>{children}</TranscriptScrollProvider>
  );
  const { result, rerender, unmount } = renderHook(({ open }) => useCompactScrollAnchor(open), {
    initialProps: { open: true },
    wrapper,
  });
  result.current.rowRef.current = row;
  act(() => result.current.beforeToggle(true));
  top = 80;
  rerender({ open: false });
  expect(controller.beginInteraction).toHaveBeenCalledTimes(following ? 0 : 1);
  expect(viewport.scrollTop).toBe(following ? 300 : 330);
  act(() => vi.advanceTimersByTime(200));
  expect(release).toHaveBeenCalledTimes(following ? 0 : 1);
  unmount();
});
