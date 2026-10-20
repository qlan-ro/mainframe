import { renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useFindInChatStore } from '../../find/find-in-chat-store';
import { useScrollSeek } from '../use-scroll-seek';

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  useFindInChatStore.setState({ isOpen: false, daemon: false });
});

it('keeps real rows during following, anchored interactions, and text selection', () => {
  const viewport = document.createElement('div');
  const text = document.createTextNode('Selected message');
  viewport.append(text);
  document.body.append(viewport);
  let following = true;
  let interacting = false;
  const scroll = {
    viewportElement: { current: viewport },
    isFollowing: () => following,
    isInteracting: () => interacting,
    beginInteraction: () => () => {},
  };
  const { result, unmount } = renderHook(() => useScrollSeek(scroll, viewport));
  try {
    expect(result.current.enter(10_000)).toBe(false);
    following = false;
    expect(result.current.enter(10_000)).toBe(true);
    useFindInChatStore.setState({ isOpen: true, daemon: false });
    expect(result.current.enter(10_000)).toBe(false);
    expect(result.current.exit(10_000)).toBe(true);
    useFindInChatStore.setState({ isOpen: false });
    expect(result.current.enter(100)).toBe(false);
    expect(result.current.exit(100)).toBe(true);
    interacting = true;
    expect(result.current.enter(10_000)).toBe(false);
    expect(result.current.exit(10_000)).toBe(true);
    interacting = false;
    const range = document.createRange();
    range.selectNodeContents(viewport);
    document.getSelection()!.addRange(range);
    expect(result.current.enter(10_000)).toBe(false);
    expect(result.current.exit(10_000)).toBe(true);
  } finally {
    unmount();
    viewport.remove();
  }
});
