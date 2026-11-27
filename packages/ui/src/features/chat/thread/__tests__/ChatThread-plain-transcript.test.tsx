/**
 * ChatThread with the plain transcript list on (Settings › Chat): the viewport is a plain element
 * under one scroll owner, not assistant-ui's `ThreadPrimitive.Viewport`, and the composer sits
 * below the scroller. Mounts the real viewport, owner and scroll-to-bottom button against a real
 * external-store runtime, as `ChatThread-scroll-ownership.test.tsx` does for today's list.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import type { ThreadMessageLike } from '@assistant-ui/react';
import { useUiPrefs } from '@/store/ui-prefs';
import { emitUserSent } from '../../controller/user-sent';

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
vi.mock('@/features/side-chat/side-chat-scope', () => ({ useSideAwareThreadId: () => 'thread-1' }));

import { ChatThreadViewport } from '../ChatThreadViewport';

const SCROLL_HEIGHT = 2000;
const CLIENT_HEIGHT = 800;
const BOTTOM = SCROLL_HEIGHT - CLIENT_HEIGHT;
const MESSAGES: ThreadMessageLike[] = [{ id: 'm1', role: 'user', content: 'hello' }];

function Harness({ children, messages }: { children: ReactNode; messages: ThreadMessageLike[] }) {
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    convertMessage: (message) => message,
    isRunning: false,
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>{children}</ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

beforeEach(() => {
  useUiPrefs.setState({ plainTranscript: true });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  useUiPrefs.setState({ plainTranscript: false });
  vi.unstubAllGlobals();
});

function renderViewport() {
  render(
    <Harness messages={MESSAGES}>
      <ChatThreadViewport variant="main" />
    </Harness>,
  );
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
  return viewport;
}

/** A reader's scroll: wheel input, then the scroll it causes. */
function readerScrollsTo(viewport: HTMLElement, scrollTop: number) {
  act(() => {
    fireEvent.wheel(viewport, { deltaY: -100 });
    viewport.scrollTop = scrollTop;
    fireEvent.scroll(viewport);
  });
}

describe('ChatThread — plain transcript list', () => {
  it('scrolls a plain element with browser anchoring on, the scrollbar thumb off and Find’s hook in place', () => {
    const viewport = renderViewport();
    expect(viewport).toHaveAttribute('data-mf-chat-thread');
    expect(viewport).toHaveAttribute('data-mf-chat-id', 'chat-1');
    expect(viewport).toHaveAttribute('data-scrollbar', 'none');
    expect(viewport.className).not.toContain('overflow-anchor');
    expect(viewport.className).toContain('overflow-y-auto');
  });

  it('puts the composer below the scroller, not inside it', () => {
    const viewport = renderViewport();
    const footer = screen.getByTestId('chat-thread-footer');
    expect(viewport).not.toContainElement(footer);
    expect(screen.getByTestId('chat-composer')).toBeInTheDocument();
    expect(footer.parentElement!.className).not.toContain('sticky');
  });

  it('follows to the tail on the user’s own send', () => {
    const viewport = renderViewport();
    readerScrollsTo(viewport, 300);
    act(() => emitUserSent(['thread-1']));
    expect(viewport.scrollTop).toBe(BOTTOM);
  });

  it('draws the edge fades as strips, not a mask on the scroller', () => {
    const viewport = renderViewport();
    expect(viewport.className).not.toContain('scroll-fade');
    expect(screen.getByTestId('chat-thread-fade-top')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('chat-thread-fade-bottom')).toHaveAttribute('aria-hidden', 'true');
  });

  it('leaves a reader who scrolled up in place', () => {
    const viewport = renderViewport();
    readerScrollsTo(viewport, 300);
    expect(viewport.scrollTop).toBe(300);
  });

  it('shows the scroll-to-bottom button once the reader is more than 2 px up, and re-pins on click', () => {
    const viewport = renderViewport();
    const button = screen.getByTestId('chat-scroll-to-bottom');
    act(() => emitUserSent(['thread-1']));
    expect(button).toBeDisabled();

    readerScrollsTo(viewport, BOTTOM - 2);
    expect(button).toBeDisabled();
    readerScrollsTo(viewport, BOTTOM - 2.5);
    expect(button).toBeEnabled();

    act(() => fireEvent.click(button));
    expect(viewport.scrollTop).toBe(BOTTOM);
    expect(button).toBeDisabled();
  });
});

describe('assistant-ui rows without its viewport', () => {
  it('renders a message under ThreadPrimitive.Root with no ThreadPrimitive.Viewport', () => {
    const Message = () => (
      <MessagePrimitive.Root data-testid="a-message">
        <MessagePrimitive.Parts />
      </MessagePrimitive.Root>
    );
    render(
      <Harness messages={MESSAGES}>
        <div data-testid="plain-scroller">
          <ThreadPrimitive.Messages components={{ UserMessage: Message, AssistantMessage: Message }} />
        </div>
      </Harness>,
    );
    expect(screen.getByTestId('a-message')).toBeInTheDocument();
  });
});
