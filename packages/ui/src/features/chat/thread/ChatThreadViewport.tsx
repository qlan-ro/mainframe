import { EarlierMessages } from './EarlierMessages';
import { useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { useUiPrefs } from '@/store/ui-prefs';
import { useSideAwareThreadId } from '@/features/side-chat/side-chat-scope';
import { TurnTranscript } from '../messages/turn/TurnTranscript';
import { useChatExtras } from '../runtime/chat-extras';
import { ContextNotPreservedNotice } from './ContextNotPreservedNotice';
import { ThreadFooter } from './ThreadFooter';
import { useThreadBottomPin } from './use-thread-bottom-pin';
import { OwnedChatThreadViewport } from './OwnedChatThreadViewport';
import { useElementHeight } from './use-element-height';
import { TranscriptScrollToBottom } from './TranscriptScrollToBottom';
import { TranscriptScrollProvider } from './transcript-scroll-context';
import { TRANSCRIPT_WIDTH_VAR, TranscriptWidthHandle } from './TranscriptWidthHandle';
import { ChatThreadLoadingSpinner, LoadErrorBanner } from './ChatThreadIndicators';
import type { ChatThreadVariant } from './ChatThread';
import type { SessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';

function useViewportScroll(threadId: string | null) {
  const pin = useThreadBottomPin(threadId);
  const { viewportElement, viewport, beginInteraction, isFollowing, isInteracting } = pin;
  const scroll = useMemo(
    () => ({ viewportElement, viewport, beginInteraction, isFollowing, isInteracting }),
    [viewportElement, viewport, beginInteraction, isFollowing, isInteracting],
  );
  return { pin, scroll };
}

/** Today's list (react-virtuoso in assistant-ui's viewport), or the plain list under one scroll owner (Settings › Chat). */
export function ChatThreadViewport(props: { emptyState?: ReactNode; variant: ChatThreadVariant }) {
  const plain = useUiPrefs((s) => s.plainTranscript);
  return plain ? <OwnedChatThreadViewport {...props} /> : <VirtualChatThreadViewport {...props} />;
}

function VirtualChatThreadViewport({ emptyState, variant }: { emptyState?: ReactNode; variant: ChatThreadVariant }) {
  const readOnly = useAuiState((s) => (s.threadListItem?.custom as SessionCustom | undefined)?.delegation != null);
  const threadId = useSideAwareThreadId();
  const { pin, scroll } = useViewportScroll(threadId);
  const { viewportRef, contentRef, footerRef } = pin;
  // The footer's measured height is the opaque bottom band of the edge-fade mask.
  const [footerEl, setFooterEl] = useState<HTMLDivElement | null>(null);
  const footerHeight = useElementHeight(footerEl);
  const [overlayHost, setOverlayHost] = useState<HTMLDivElement | null>(null);
  const composedFooterRef = useCallback(
    (node: HTMLDivElement | null) => {
      footerRef(node);
      setFooterEl(node);
    },
    [footerRef],
  );
  const messageCount = useAuiState((s) => s.thread.messages.length);
  const chatId = useChatExtras()?.state.chatId;
  const rootRef = useRef<HTMLDivElement>(null);
  const transcriptWidth = useUiPrefs((s) => s.transcriptWidth);
  return (
    <TranscriptScrollProvider value={scroll}>
      {/* WebKit loses scroll offsets when size containment is on the viewport itself. */}
      <div
        ref={rootRef}
        style={{ [TRANSCRIPT_WIDTH_VAR]: `${transcriptWidth}px` } as CSSProperties}
        className="relative flex min-h-0 flex-1 flex-col [container-type:size]"
      >
        {/* assistant-ui's scroll controllers are off: following, the jump to the
            bottom on open and the scroll-to-bottom button all belong to
            `useThreadBottomPin`. A run that starts by itself (a queued prompt,
            a background task, a resumed permission wait) must not pull a reader
            who scrolled up; the user's own send re-pins through the pin instead.
            One library path stays on and has no switch: its prepend correction
            (`messagesPrepended` in @assistant-ui/store's
            thread-viewport-auto-scroll), which holds the first message in place
            when older messages load above it. */}
        <ThreadPrimitive.Viewport
          ref={viewportRef}
          autoScroll={false}
          scrollToBottomOnRunStart={false}
          scrollToBottomOnInitialize={false}
          scrollToBottomOnThreadSwitch={false}
          data-testid="chat-thread-viewport"
          data-mf-chat-thread
          data-mf-chat-id={chatId}
          data-scrollbar="none"
          tabIndex={-1}
          style={{ '--scroll-fade-inset-b': `${footerHeight}px` } as CSSProperties}
          className="scroll-fade-y scroll-fade-sticky relative flex flex-1 flex-col overflow-y-auto [overflow-anchor:none]"
        >
          <ChatThreadLoadingSpinner />
          <div
            ref={contentRef}
            className="relative mx-auto w-[calc(100%-0.5rem)] max-w-(--mf-transcript-width) flex-1 px-5 py-4"
          >
            <TranscriptWidthHandle side="left" rootRef={rootRef} />
            <TranscriptWidthHandle side="right" rootRef={rootRef} />
            <LoadErrorBanner />
            {variant !== 'side' && <ContextNotPreservedNotice />}
            {messageCount === 0 && emptyState != null ? emptyState : null}
            <EarlierMessages />
            <TurnTranscript key={threadId ?? ''} />
          </div>
          <ThreadFooter variant={variant} readOnly={readOnly} footerRef={composedFooterRef} />
          <TranscriptScrollToBottom
            host={overlayHost}
            footerHeight={footerHeight}
            isPinned={pin.isPinned}
            subscribePinned={pin.subscribePinned}
            onPin={pin.pinToBottom}
          />
        </ThreadPrimitive.Viewport>
        <div ref={setOverlayHost} className="pointer-events-none absolute inset-0" />
      </div>
    </TranscriptScrollProvider>
  );
}
