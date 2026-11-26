// @vitest-environment jsdom
/**
 * The bottom pin's explicit re-pin (End key, scroll-to-bottom button, the
 * user's own send), its subscription for the button, and the one "at the
 * bottom" predicate they share.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { emitUserSent } from '../../controller/user-sent';
import { isAtBottom } from '../bottom-pin';
import { useThreadBottomPin } from '../use-thread-bottom-pin';
import { createViewport, installPinDoubles, notifyResize } from './pin-viewport-fixture';

installPinDoubles();

function mountPin() {
  const viewport = createViewport();
  const hook = renderHook(() => useThreadBottomPin('chat-1'));
  act(() => {
    hook.result.current.viewportRef(viewport.element);
    hook.result.current.contentRef(document.createElement('div'));
  });
  return { viewport, pin: () => hook.result.current };
}

function metrics(scrollTop: number) {
  return { scrollHeight: 1_000, clientHeight: 100, scrollTop } as HTMLElement;
}

describe('isAtBottom', () => {
  it('allows two pixels of slack and no more, fractional offsets included', () => {
    expect(isAtBottom(metrics(900))).toBe(true);
    expect(isAtBottom(metrics(898))).toBe(true);
    expect(isAtBottom(metrics(897.5))).toBe(false);
  });
});

describe('following', () => {
  it('follows streamed growth while at the bottom', () => {
    const { viewport, pin } = mountPin();
    act(() => {
      viewport.resize(1_300);
      notifyResize();
    });
    expect(viewport.element.scrollTop).toBe(1_200);
    expect(pin().isPinned()).toBe(true);
  });
});

describe('pinToBottom (the user’s own send)', () => {
  it('jumps a reader who scrolled up to the end and keeps following', () => {
    const { viewport, pin } = mountPin();
    act(() => viewport.scrollTo(250));
    expect(pin().isPinned()).toBe(false);

    act(() => pin().pinToBottom());
    expect(viewport.element.scrollTop).toBe(900);
    expect(pin().isPinned()).toBe(true);

    act(() => {
      viewport.resize(1_400);
      notifyResize();
    });
    expect(viewport.element.scrollTop).toBe(1_300);
  });

  it('lands at the bottom when it arrives during an interaction lock', () => {
    const { viewport, pin } = mountPin();
    act(() => viewport.scrollTo(250));
    const release = pin().beginInteraction();
    act(() => pin().pinToBottom());
    // The holder still owns the offset: the jump waits for its release.
    expect(viewport.element.scrollTop).toBe(250);
    expect(pin().isPinned()).toBe(true);
    // The lock holder moves the offset and the content grows meanwhile.
    viewport.element.scrollTop = 400;
    viewport.resize(1_500);
    act(() => release());
    expect(viewport.element.scrollTop).toBe(1_400);
    expect(pin().isFollowing()).toBe(true);
  });
});

describe('the user-sent event', () => {
  it('re-pins on a send in its own chat and ignores other chats', () => {
    const { viewport, pin } = mountPin();
    act(() => viewport.scrollTo(250));

    act(() => emitUserSent(['chat-2']));
    expect(viewport.element.scrollTop).toBe(250);
    expect(pin().isPinned()).toBe(false);

    act(() => emitUserSent(['chat-1']));
    expect(viewport.element.scrollTop).toBe(900);
    expect(pin().isPinned()).toBe(true);
  });
});

describe('subscribePinned', () => {
  it('notifies only when the pin flips', () => {
    const { viewport, pin } = mountPin();
    const listener = vi.fn();
    const unsubscribe = pin().subscribePinned(listener);

    act(() => viewport.scrollTo(250));
    act(() => viewport.scrollTo(200));
    expect(listener).toHaveBeenCalledTimes(1);

    act(() => pin().pinToBottom());
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    act(() => viewport.scrollTo(250));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('re-pins on the End key', () => {
    const { viewport, pin } = mountPin();
    act(() => viewport.scrollTo(250));
    act(() => {
      viewport.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', cancelable: true }));
    });
    expect(viewport.element.scrollTop).toBe(900);
    expect(pin().isPinned()).toBe(true);
  });
});
