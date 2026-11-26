/** Shared viewport, ResizeObserver and frame doubles for the bottom-pin suites. */
import { beforeEach, afterEach, vi } from 'vitest';

type ResizeCallback = ResizeObserverCallback;

export class RecordingResizeObserver implements ResizeObserver {
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

export function createViewport() {
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

export let frames: FrameRequestCallback[] = [];

/** Installs the doubles around each test of the calling suite. */
export function installPinDoubles() {
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
}

export function flushFrame() {
  const callbacks = frames.splice(0);
  callbacks.forEach((callback) => callback(0));
}

export function notifyResize() {
  const observer = RecordingResizeObserver.instances[RecordingResizeObserver.instances.length - 1];
  if (!observer) throw new Error('ResizeObserver was not created');
  observer.callback([], observer);
  flushFrame();
}
