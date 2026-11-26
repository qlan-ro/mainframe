/**
 * ChatThread — the scroll-to-bottom button's at-bottom threshold.
 *
 * assistant-ui 0.15.38 counts a registered `ThreadPrimitive.ViewportFooter`'s
 * height as content inset: any position within that height of the bottom reads
 * as "at bottom", and `ThreadPrimitive.ScrollToBottom` disables (hides) the
 * button. Mainframe's footer holds the composer, gates and bottom strip, so a
 * reader could scroll a whole composer-height up with no button. This suite
 * mounts the real viewport and button against a real runtime, with a 200 px
 * footer, and checks the button still appears 2 px from the bottom.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AssistantRuntimeProvider, ThreadPrimitive, useExternalStoreRuntime } from '@assistant-ui/react';
import type { ThreadMessage } from '@assistant-ui/react';

vi.mock('../use-thread-bottom-pin', () => ({
  useThreadBottomPin: () => ({
    viewportRef: () => {},
    contentRef: () => {},
    footerRef: () => {},
    viewportElement: { current: null },
    viewport: null,
    beginInteraction: () => () => {},
    isFollowing: () => true,
    isInteracting: () => false,
  }),
}));
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

function Harness({ children }: { children: ReactNode }) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({ messages: [], isRunning: false, onNew: async () => {} });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>{children}</ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

/** The footer band is the element wrapping `chat-thread-footer`. */
const isFooterBand = (el: HTMLElement) => el.firstElementChild?.getAttribute('data-testid') === 'chat-thread-footer';

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return isFooterBand(this) ? FOOTER_HEIGHT : 0;
  });
});
afterEach(() => vi.restoreAllMocks());

function scrollToGap(viewport: HTMLElement, gap: number) {
  act(() => {
    viewport.scrollTop = SCROLL_HEIGHT - CLIENT_HEIGHT - gap;
    fireEvent.scroll(viewport);
  });
}

describe('ChatThread — scroll-to-bottom threshold', () => {
  it('shows the button 2 px above the bottom, whatever the footer height', () => {
    render(
      <Harness>
        <ChatThreadViewport variant="main" />
      </Harness>,
    );
    const viewport = screen.getByTestId('chat-thread-viewport');
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: SCROLL_HEIGHT });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: CLIENT_HEIGHT });
    const button = screen.getByTestId('chat-scroll-to-bottom');

    scrollToGap(viewport, 1);
    expect(button).toBeDisabled();

    scrollToGap(viewport, 2);
    expect(button).toBeEnabled();
  });
});
