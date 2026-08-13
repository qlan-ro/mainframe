// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useThreadBottomPin } from '../use-thread-bottom-pin';

type ResizeCallback = ResizeObserverCallback;

class RecordingResizeObserver implements ResizeObserver {
  static instances: RecordingResizeObserver[] = [];

  readonly callback: ResizeCallback;
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();

  constructor(callback: ResizeCallback) {
    this.callback = callback;
    RecordingResizeObserver.instances.push(this);
  }
}

function createViewport() {
  const element = document.createElement('div');
  const clientHeight = 100;
  let scrollHeight = 1_000;
  let scrollTop = 900;

  Object.defineProperties(element, {
    clientHeight: { get: () => clientHeight },
    scrollHeight: { get: () => scrollHeight },
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.min(value, Math.max(0, scrollHeight - clientHeight));
      },
    },
  });

  return {
    element,
    resize(height: number) {
      scrollHeight = height;
      scrollTop = Math.min(scrollTop, Math.max(0, scrollHeight - clientHeight));
    },
    scrollTo(top: number) {
      element.scrollTop = top;
      element.dispatchEvent(new Event('scroll'));
    },
  };
}

let frames: FrameRequestCallback[];

beforeEach(() => {
  frames = [];
  RecordingResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', RecordingResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function flushFrame() {
  const callbacks = frames.splice(0);
  callbacks.forEach((callback) => callback(0));
}

function notifyResize() {
  const observer = RecordingResizeObserver.instances[RecordingResizeObserver.instances.length - 1];
  if (!observer) throw new Error('ResizeObserver was not created');
  observer.callback([], observer);
  flushFrame();
}

it('restores a pinned transcript to the bottom after its content shrinks and regrows', () => {
  const viewport = createViewport();
  const content = document.createElement('div');
  const { result } = renderHook(() => useThreadBottomPin('chat-1'));

  act(() => {
    result.current.viewportRef(viewport.element);
    result.current.contentRef(content);
    viewport.resize(400);
    viewport.resize(1_000);
    notifyResize();
  });

  expect(viewport.element.scrollTop).toBe(900);
});

it('preserves the reading position when the user has scrolled up', () => {
  const viewport = createViewport();
  const content = document.createElement('div');
  const { result } = renderHook(() => useThreadBottomPin('chat-1'));

  act(() => {
    result.current.viewportRef(viewport.element);
    result.current.contentRef(content);
    viewport.scrollTo(250);
    viewport.resize(1_200);
    notifyResize();
  });

  expect(viewport.element.scrollTop).toBe(250);
});

it('pins again after the user returns to the bottom', () => {
  const viewport = createViewport();
  const content = document.createElement('div');
  const { result } = renderHook(() => useThreadBottomPin('chat-1'));

  act(() => {
    result.current.viewportRef(viewport.element);
    result.current.contentRef(content);
    viewport.scrollTo(250);
    viewport.scrollTo(900);
    viewport.resize(1_200);
    notifyResize();
  });

  expect(viewport.element.scrollTop).toBe(1_100);
});

// ── Switching sessions ───────────────────────────────────────────────────────
// The viewport is ONE element shared by every session in the single-thread
// surface, so its scrollTop survives a switch. assistant-ui's own
// switch-scroll (`threadListItem.switchedTo`) never reaches it in our tree,
// which left a switched-into session parked at the previous one's offset.

it('returns to the bottom when the active session changes, even after the user scrolled up', () => {
  const viewport = createViewport();
  const content = document.createElement('div');
  const { result, rerender } = renderHook(({ threadId }) => useThreadBottomPin(threadId), {
    initialProps: { threadId: 'chat-1' },
  });

  act(() => {
    result.current.viewportRef(viewport.element);
    result.current.contentRef(content);
    viewport.scrollTo(250);
  });

  act(() => {
    rerender({ threadId: 'chat-2' });
  });

  expect(viewport.element.scrollTop).toBe(900);
});

it('follows content that only arrives after the switch', () => {
  const viewport = createViewport();
  const content = document.createElement('div');
  const { result, rerender } = renderHook(({ threadId }) => useThreadBottomPin(threadId), {
    initialProps: { threadId: 'chat-1' },
  });

  act(() => {
    result.current.viewportRef(viewport.element);
    result.current.contentRef(content);
    viewport.scrollTo(250);
  });

  act(() => {
    rerender({ threadId: 'chat-2' });
    // The switched-into session's history lands a beat later (async load,
    // lazy code blocks, images) — the pin must follow it down.
    viewport.resize(3_000);
    notifyResize();
  });

  expect(viewport.element.scrollTop).toBe(2_900);
});

it('leaves the reading position alone when the session has not changed', () => {
  const viewport = createViewport();
  const content = document.createElement('div');
  const { result, rerender } = renderHook(({ threadId }) => useThreadBottomPin(threadId), {
    initialProps: { threadId: 'chat-1' },
  });

  act(() => {
    result.current.viewportRef(viewport.element);
    result.current.contentRef(content);
    viewport.scrollTo(250);
  });

  act(() => {
    rerender({ threadId: 'chat-1' });
  });

  expect(viewport.element.scrollTop).toBe(250);
});
