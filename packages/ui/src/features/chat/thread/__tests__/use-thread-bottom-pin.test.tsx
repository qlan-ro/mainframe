// @vitest-environment jsdom
import { act, render, renderHook } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useThreadBottomPin } from '../use-thread-bottom-pin';
import type { TranscriptScrollController } from '../transcript-scroll-context';

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
  let clientHeight = 100;
  let scrollHeight = 1_000;
  let scrollTop = 900;

  Object.defineProperties(element, {
    clientHeight: { get: () => clientHeight },
    scrollHeight: { get: () => (clientHeight === 0 ? 0 : scrollHeight) },
    scrollTop: {
      get: () => (clientHeight === 0 ? 0 : scrollTop),
      set: (value: number) => {
        scrollTop = Math.min(value, Math.max(0, scrollHeight - clientHeight));
      },
    },
  });

  return {
    element,
    setVisible(visible: boolean) {
      clientHeight = visible ? 100 : 0;
    },
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

it('observes viewport and composer resizing as well as transcript content', () => {
  const viewport = createViewport();
  const content = document.createElement('div');
  const footer = document.createElement('div');
  const { result } = renderHook(() => useThreadBottomPin('chat-1'));
  act(() => {
    result.current.contentRef(content);
    result.current.footerRef(footer);
    result.current.viewportRef(viewport.element);
  });
  const observer = RecordingResizeObserver.instances[RecordingResizeObserver.instances.length - 1]!;
  expect(observer.observe).toHaveBeenCalledWith(content);
  expect(observer.observe).toHaveBeenCalledWith(footer);
  expect(observer.observe).toHaveBeenCalledWith(viewport.element);
  act(() => {
    viewport.resize(1_100);
    notifyResize();
  });
  expect(viewport.element.scrollTop).toBe(1_000);
});

it('does not schedule animation frames for streaming content while reading history', () => {
  const viewport = createViewport();
  const { result } = renderHook(() => useThreadBottomPin('chat-1'));
  act(() => {
    result.current.viewportRef(viewport.element);
    result.current.contentRef(document.createElement('div'));
    viewport.scrollTo(250);
    const observer = RecordingResizeObserver.instances[RecordingResizeObserver.instances.length - 1]!;
    for (let i = 0; i < 30; i++) observer.callback([], observer);
  });
  expect(frames).toHaveLength(0);
  expect(viewport.element.scrollTop).toBe(250);
});

it('resumes following when growth arrives before the scroll-to-bottom event', () => {
  const viewport = createViewport();
  const { result } = renderHook(() => useThreadBottomPin('chat-1'));
  act(() => {
    result.current.viewportRef(viewport.element);
    result.current.contentRef(document.createElement('div'));
    viewport.scrollTo(250);
    viewport.element.scrollTop = 900;
    viewport.resize(1_100);
    notifyResize();
  });
  expect(viewport.element.scrollTop).toBe(1_000);
});

it('keeps the reading position when a hidden window reports zero dimensions', () => {
  const viewport = createViewport();
  const { result } = renderHook(() => useThreadBottomPin('chat-1'));
  act(() => {
    result.current.viewportRef(viewport.element);
    result.current.contentRef(document.createElement('div'));
    viewport.scrollTo(250);
    viewport.setVisible(false);
    viewport.element.dispatchEvent(new Event('scroll'));
    notifyResize();
    viewport.setVisible(true);
    notifyResize();
  });
  expect(viewport.element.scrollTop).toBe(250);
});

it('keeps following through duplicate layout scroll events before the resize frame', () => {
  const viewport = createViewport();
  const { result } = renderHook(() => useThreadBottomPin('chat-1'));
  act(() => {
    result.current.viewportRef(viewport.element);
    result.current.contentRef(document.createElement('div'));
    viewport.resize(1_200);
    viewport.scrollTo(1_050);
    viewport.element.dispatchEvent(new Event('scroll'));
    notifyResize();
  });
  expect(viewport.element.scrollTop).toBe(1_100);
});

it('keeps following when a shrink clamp is reported after the content regrew', () => {
  const viewport = createViewport();
  const { result } = renderHook(() => useThreadBottomPin('chat-1'));
  act(() => {
    result.current.viewportRef(viewport.element);
    result.current.contentRef(document.createElement('div'));
    // WebKit delivers the clamp from the shrink only after the next growth.
    viewport.resize(800);
    viewport.resize(1_200);
    viewport.element.dispatchEvent(new Event('scroll'));
    flushFrame();
  });
  expect(viewport.element.scrollTop).toBe(1_100);
  expect(result.current.isFollowing()).toBe(true);
});

it('stops following when the user scrolls up while content grows', () => {
  const viewport = createViewport();
  const { result } = renderHook(() => useThreadBottomPin('chat-1'));
  act(() => {
    result.current.viewportRef(viewport.element);
    result.current.contentRef(document.createElement('div'));
    viewport.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -300 }));
    viewport.resize(1_200);
    viewport.scrollTo(600);
    notifyResize();
  });
  expect(viewport.element.scrollTop).toBe(600);
  expect(result.current.isFollowing()).toBe(false);
});

it('reports following to child layout effects on the commit that switches sessions', () => {
  const viewport = createViewport();
  const seen: boolean[] = [];
  let controller: ReturnType<typeof useThreadBottomPin> | null = null;
  function Child({ threadId, scroll }: { threadId: string; scroll: TranscriptScrollController }) {
    useLayoutEffect(() => {
      seen.push(scroll.isFollowing());
    }, [threadId, scroll]);
    return null;
  }
  function Thread({ threadId }: { threadId: string }) {
    const pin = useThreadBottomPin(threadId);
    controller = pin;
    return <Child threadId={threadId} scroll={pin} />;
  }
  const { rerender } = render(<Thread threadId="chat-1" />);
  act(() => {
    controller!.viewportRef(viewport.element);
    controller!.contentRef(document.createElement('div'));
    viewport.scrollTo(250);
  });
  const staleRelease = controller!.beginInteraction();
  rerender(<Thread threadId="chat-2" />);
  expect(seen[seen.length - 1]).toBe(true);
  staleRelease();
  expect(controller!.isFollowing()).toBe(true);
});
