/**
 * ChatThread — who scrolls the transcript.
 *
 * Mounts the real viewport, the real bottom pin and the real scroll-to-bottom
 * button against a real external-store runtime. assistant-ui's own scroll
 * controllers are switched off, so:
 *  - a run that starts by itself, or history arriving, does not pull a reader
 *    who scrolled up (part 2, S7);
 *  - the button shows from the pin's own "at the bottom", whatever the footer
 *    height, and its click re-pins through the pin (S8).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AssistantRuntimeProvider, ThreadPrimitive, useExternalStoreRuntime } from '@assistant-ui/react';
import type { ThreadMessageLike } from '@assistant-ui/react';

vi.mock('../../messages/turn/TurnTranscript', () => ({ TurnTranscript: () => null }));
vi.mock('../EarlierMessages', () => ({ EarlierMessages: () => null }));
vi.mock('../ContextNotPreservedNotice', () => ({ ContextNotPreservedNotice: () => null }));
vi.mock('../ChatThreadIndicators', () => ({ ChatThreadLoadingSpinner: () => null, LoadErrorBanner: () => null }));
vi.mock('../TranscriptWidthHandle', () => ({
  TRANSCRIPT_WIDTH_VAR: '--mf-transcript-width',
  TranscriptWidthHandle: () => null,
}));
vi.mock('../DegradedChatCard', () => ({ DegradedChatCard: () => null }));
vi.mock('../../composer/Composer', () => ({ Composer: () => <div data-testid="chat-composer" /> }));
vi.mock('../../composer/WorktreeSwitchBanner', () => ({ WorktreeSwitchBanner: () => null }));
vi.mock('../../composer/strips/BottomStrip', () => ({ BottomStrip: () => null }));
vi.mock('../../composer/strips/DraftStrip', () => ({ DraftStrip: () => null }));
vi.mock('../../orchestration/AgentOutboxChip', () => ({ AgentOutboxChip: () => null }));
vi.mock('../../gates/ChatGateMount', () => ({ ChatGateMount: () => null }));
vi.mock('../../runtime/chat-extras', () => ({ useChatExtras: () => ({ state: { chatId: 'chat-1' } }) }));

import { ChatThreadViewport } from '../ChatThreadViewport';

const FOOTER_HEIGHT = 200;
const SCROLL_HEIGHT = 2000;
const CLIENT_HEIGHT = 800;
const BOTTOM = SCROLL_HEIGHT - CLIENT_HEIGHT;
const MESSAGES: ThreadMessageLike[] = [{ id: 'm1', role: 'user', content: 'hello' }];

let frames: FrameRequestCallback[] = [];

function Harness({
  children,
  messages,
  isRunning,
}: {
  children: ReactNode;
  messages: ThreadMessageLike[];
  isRunning: boolean;
}) {
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    convertMessage: (message) => message,
    isRunning,
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>{children}</ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

/** The footer band is the element wrapping `chat-thread-footer`. */
const isFooterBand = (el: HTMLElement) => el.firstElementChild?.getAttribute('data-testid') === 'chat-thread-footer';

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return isFooterBand(this) ? FOOTER_HEIGHT : 0;
  });
  // jsdom has no layout: route assistant-ui's `scrollTo` to scrollTop so its
  // scroll-to-bottom would show up here if it fired.
  HTMLElement.prototype.scrollTo = function (this: HTMLElement, options?: ScrollToOptions | number) {
    if (typeof options === 'object' && options.top !== undefined) this.scrollTop = options.top;
  } as HTMLElement['scrollTo'];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function flushFrames() {
  for (let i = 0; i < 5 && frames.length; i++) frames.splice(0).forEach((frame) => frame(0));
}

const tree = (isRunning: boolean) => (
  <Harness messages={MESSAGES} isRunning={isRunning}>
    <ChatThreadViewport variant="main" />
  </Harness>
);

function renderViewport() {
  const { rerender } = render(tree(false));
  const viewport = screen.getByTestId('chat-thread-viewport');
  let top = 0;
  Object.defineProperties(viewport, {
    scrollHeight: { configurable: true, value: SCROLL_HEIGHT },
    clientHeight: { configurable: true, value: CLIENT_HEIGHT },
    scrollTop: {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(value, BOTTOM));
      },
    },
  });
  return { viewport, setRunning: (isRunning: boolean) => rerender(tree(isRunning)) };
}

/** A reader's scroll: wheel input, then the scroll it causes. */
function readerScrollsTo(viewport: HTMLElement, scrollTop: number) {
  act(() => {
    fireEvent.wheel(viewport, { deltaY: -100 });
    viewport.scrollTop = scrollTop;
    fireEvent.scroll(viewport);
  });
}

describe('ChatThread — assistant-ui does not scroll the transcript', () => {
  it('leaves a reader who scrolled up in place when a run starts by itself', async () => {
    const { viewport, setRunning } = renderViewport();
    act(flushFrames);
    readerScrollsTo(viewport, 300);

    // assistant-ui delivers `thread.runStart` after the store update settles.
    await act(async () => setRunning(true));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    act(flushFrames);

    expect(viewport.scrollTop).toBe(300);
  });

  it('leaves a reader who scrolled up in place when history first arrives', () => {
    const { viewport } = renderViewport();
    readerScrollsTo(viewport, 300);
    act(flushFrames);

    expect(viewport.scrollTop).toBe(300);
  });
});

describe('ChatThread — the scroll-to-bottom button follows the pin', () => {
  it('shows once the reader is more than 2 px up, whatever the footer height', () => {
    const { viewport } = renderViewport();
    const button = screen.getByTestId('chat-scroll-to-bottom');
    expect(button).toBeDisabled();

    readerScrollsTo(viewport, BOTTOM - 2);
    expect(button).toBeDisabled();

    readerScrollsTo(viewport, BOTTOM - 2.5);
    expect(button).toBeEnabled();
  });

  it('re-pins to the bottom on click and hides again', () => {
    const { viewport } = renderViewport();
    const button = screen.getByTestId('chat-scroll-to-bottom');
    readerScrollsTo(viewport, 300);
    expect(button).toBeEnabled();

    act(() => fireEvent.click(button));

    expect(viewport.scrollTop).toBe(BOTTOM);
    expect(button).toBeDisabled();
  });
});
