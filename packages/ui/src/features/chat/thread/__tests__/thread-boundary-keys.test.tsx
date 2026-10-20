// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useThreadBottomPin } from '../use-thread-bottom-pin';

let frame: FrameRequestCallback | undefined;
beforeEach(() => {
  frame = undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

function viewport() {
  const element = document.createElement('div');
  let scrollTop = 0;
  Object.defineProperties(element, {
    clientHeight: { value: 100 },
    scrollHeight: { value: 1000, configurable: true },
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, Math.min(value, 900));
      },
    },
  });
  return element;
}

function key(target: HTMLElement, name: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, shiftKey });
  target.dispatchEvent(event);
  return event;
}

it('Home unpins before a pending follow frame and reaches the loaded history boundary', () => {
  const element = viewport();
  const { result } = renderHook(() => useThreadBottomPin('chat'));
  act(() => result.current.viewportRef(element));
  element.scrollTop = 900;
  const event = key(element, 'Home');
  expect(event.defaultPrevented).toBe(true);
  expect(element.scrollTop).toBe(0);
  expect(result.current.isFollowing()).toBe(false);
  act(() => frame?.(0));
  expect(element.scrollTop).toBe(0);
});

it('End reaches the tail and restores following', () => {
  const element = viewport();
  const { result } = renderHook(() => useThreadBottomPin('chat'));
  act(() => result.current.viewportRef(element));
  key(element, 'Home');
  const event = key(element, 'End');
  expect(event.defaultPrevented).toBe(true);
  expect(element.scrollTop).toBe(900);
  expect(result.current.isFollowing()).toBe(true);
});

it('preserves editor keys and modified selection gestures', () => {
  const element = viewport();
  const input = document.createElement('textarea');
  element.append(input);
  const { result } = renderHook(() => useThreadBottomPin('chat'));
  act(() => result.current.viewportRef(element));
  element.scrollTop = 500;
  expect(key(input, 'Home').defaultPrevented).toBe(false);
  expect(key(element, 'Home', true).defaultPrevented).toBe(false);
  expect(element.scrollTop).toBe(500);
});
