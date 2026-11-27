import { EarlierMessages } from './EarlierMessages';
import { LaterMessages } from './LaterMessages';
import { useTrimAtTail } from './use-trim-at-tail';
import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useUiPrefs } from '@/store/ui-prefs';
import { useSideAwareThreadId } from '@/features/side-chat/side-chat-scope';
import { TurnTranscript } from '../messages/turn/TurnTranscript';
import { useChatExtras } from '../runtime/chat-extras';
import { ContextNotPreservedNotice } from './ContextNotPreservedNotice';
import { TranscriptEdgeFades } from './TranscriptEdgeFades';
import { ThreadFooter } from './ThreadFooter';
import { useElementHeight } from './use-element-height';
import { useScrollOwner } from './use-scroll-owner';
import { TranscriptScrollToBottom } from './TranscriptScrollToBottom';
import { TranscriptScrollProvider } from './transcript-scroll-context';
import { TRANSCRIPT_WIDTH_VAR, TranscriptWidthHandle } from './TranscriptWidthHandle';
import { ChatThreadLoadingSpinner, LoadErrorBanner } from './ChatThreadIndicators';
import type { ChatThreadVariant } from './ChatThread';
import type { SessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';

/** In a window around a jump target the bottom is not the live tail: the button always takes the reader there. */
const NEVER_PINNED = () => false;

/**
 * The transcript with plain rows and one scroll owner (`use-scroll-owner.ts`), behind
 * Settings › Chat. Differences from the virtualized viewport:
 *
 * - The scroller is a plain element, not `ThreadPrimitive.Viewport`: assistant-ui's prepend
 *   correction (`messagesPrepended`) cannot fight the owner, and none of its scroll controllers exist.
 * - Browser scroll anchoring is on (no `overflow-anchor: none`).
 * - The composer is below the scroller, not sticky inside it, so the reader's scroll area is only the
 *   transcript and "the bottom" needs no footer arithmetic.
 * - The scrollbar thumb is off: it jumped and resized as older pages landed.
 * - The edge fades are gradient strips, not a mask: a mask on a scroller with every row mounted costs
 *   a streaming reply most of its frames (`TranscriptEdgeFades.tsx`).
 */
export function OwnedChatThreadViewport({
  emptyState,
  variant,
}: {
  emptyState?: ReactNode;
  variant: ChatThreadVariant;
}) {
  const readOnly = useAuiState((s) => (s.threadListItem?.custom as SessionCustom | undefined)?.delegation != null);
  const threadId = useSideAwareThreadId();
  const extras = useChatExtras();
  const chatId = extras?.state.chatId;
  const away = extras?.state.historyWindow?.detached != null;
  // Find searches the focused main chat only; the plain list reveals every row for it (use-tail-first-rows.ts).
  const focused = useAuiState((s) => s.threads?.mainThreadId === s.threadListItem?.id);
  const owner = useScrollOwner(threadId, chatId, { findOwner: focused && variant === 'main', away });
  useTrimAtTail(owner, extras?.trimToNewestPage, away);
  const [footerEl, setFooterEl] = useState<HTMLDivElement | null>(null);
  const footerHeight = useElementHeight(footerEl);
  const [overlayHost, setOverlayHost] = useState<HTMLDivElement | null>(null);
  const messageCount = useAuiState((s) => s.thread.messages.length);
  const rootRef = useRef<HTMLDivElement>(null);
  const transcriptWidth = useUiPrefs((s) => s.transcriptWidth);
  const footerRef = useCallback((node: HTMLDivElement | null) => setFooterEl(node), []);
  return (
    <TranscriptScrollProvider value={owner.controller}>
      {/* WebKit loses scroll offsets when size containment is on the scroller itself. */}
      <div
        ref={rootRef}
        style={{ [TRANSCRIPT_WIDTH_VAR]: `${transcriptWidth}px` } as CSSProperties}
        className="relative flex min-h-0 flex-1 flex-col [container-type:size]"
      >
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={owner.setViewport}
            data-testid="chat-thread-viewport"
            data-mf-chat-thread
            data-mf-chat-id={chatId}
            data-scrollbar="none"
            tabIndex={-1}
            className="relative flex min-h-0 flex-1 flex-col overflow-y-auto"
          >
            <ChatThreadLoadingSpinner />
            <div
              ref={owner.setContent}
              className="relative mx-auto w-[calc(100%-0.5rem)] max-w-(--mf-transcript-width) flex-1 px-5 py-4"
            >
              <TranscriptWidthHandle side="left" rootRef={rootRef} />
              <TranscriptWidthHandle side="right" rootRef={rootRef} />
              <LoadErrorBanner />
              {variant !== 'side' && <ContextNotPreservedNotice />}
              {messageCount === 0 && emptyState != null ? emptyState : null}
              <EarlierMessages />
              <TurnTranscript key={threadId ?? ''} />
              <LaterMessages />
            </div>
          </div>
          <TranscriptEdgeFades />
        </div>
        <ThreadFooter variant={variant} readOnly={readOnly} footerRef={footerRef} sticky={false} />
        <div ref={setOverlayHost} className="pointer-events-none absolute inset-0" />
        <TranscriptScrollToBottom
          host={overlayHost}
          footerHeight={footerHeight}
          isPinned={away ? NEVER_PINNED : owner.isPinned}
          subscribePinned={owner.subscribePinned}
          onPin={away && extras?.returnToTail ? extras.returnToTail : owner.pinToBottom}
        />
      </div>
    </TranscriptScrollProvider>
  );
}
