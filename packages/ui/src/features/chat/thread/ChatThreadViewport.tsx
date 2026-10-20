import { EarlierMessages } from './EarlierMessages';
import { lazy, Suspense, useMemo, useRef, type CSSProperties, type ReactNode, type RefCallback } from 'react';
import { ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { ArrowDownIcon } from 'lucide-react';
import { useUiPrefs } from '@/store/ui-prefs';
import { Button } from '@/components/ui/button';
import { useSideAwareThreadId } from '@/features/side-chat/side-chat-scope';
import { useDraftConfigStore } from '@/features/sessions/runtime/draft-config';
import { Composer } from '../composer/Composer';
import { WorktreeSwitchBanner } from '../composer/WorktreeSwitchBanner';
import { AgentOutboxChip } from '../orchestration/AgentOutboxChip';
import { boundedMessageComponents } from '../messages/bounded-messages';
import { ChatGateMount } from '../gates/ChatGateMount';
import { useChatExtras } from '../runtime/chat-extras';
import { ContextNotPreservedNotice } from './ContextNotPreservedNotice';
import { DegradedChatCard } from './DegradedChatCard';
import { useThreadBottomPin } from './use-thread-bottom-pin';
import { ProgressiveMessages } from './ProgressiveMessages';
import { TranscriptScrollProvider } from './transcript-scroll-context';
import { TRANSCRIPT_WIDTH_VAR, TranscriptWidthHandle } from './TranscriptWidthHandle';
import {
  ChatThreadLoadingSpinner,
  LoadErrorBanner,
  GeneratingIndicator,
  CompactingIndicator,
} from './ChatThreadIndicators';
import type { ChatThreadVariant } from './ChatThread';
import type { SessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';

const CompactTranscript = lazy(() =>
  import('../messages/compact/CompactTranscript').then((module) => ({ default: module.CompactTranscript })),
);
function TranscriptMessages() {
  const mode = useUiPrefs((state) => state.transcriptMode);
  return mode === 'compact' ? (
    <Suspense fallback={null}>
      <CompactTranscript />
    </Suspense>
  ) : (
    <ProgressiveMessages components={boundedMessageComponents} />
  );
}
function ThreadFooterInput({ variant }: { variant: ChatThreadVariant }) {
  const directoryMissing = useChatExtras()?.state.chatConfig?.directoryMissing ?? false;
  const itemId = useSideAwareThreadId();
  const itemStatus = useAuiState((s) => s.threadListItem?.status);
  const hasDraftCfg = useDraftConfigStore((s) => (itemId ? s.drafts.has(itemId) : false));
  const projectlessDraft = itemId?.startsWith('__LOCALID_') === true && itemStatus === 'new' && !hasDraftCfg;
  return (
    <>
      <DegradedChatCard />
      {!directoryMissing && !projectlessDraft && <Composer variant={variant} />}
    </>
  );
}
function ThreadFooter({
  variant,
  readOnly,
  footerRef,
}: {
  variant: ChatThreadVariant;
  readOnly: boolean;
  footerRef: RefCallback<HTMLDivElement>;
}) {
  return (
    <ThreadPrimitive.ViewportFooter
      ref={footerRef}
      className="sticky bottom-0 mt-auto flex max-h-[calc(100cqh-2rem)] shrink-0 flex-col bg-background"
    >
      <ThreadPrimitive.ScrollToBottom asChild>
        <Button
          data-testid="chat-scroll-to-bottom"
          aria-label="Scroll to bottom"
          variant="outline"
          size="icon-sm"
          className="absolute -top-10 left-1/2 z-10 -translate-x-1/2 rounded-full text-muted-foreground shadow-md disabled:invisible"
        >
          <ArrowDownIcon />
        </Button>
      </ThreadPrimitive.ScrollToBottom>
      {/* The transcript column's width (ui-prefs, 680px by default), not
          `min(48rem, 100% − 116px)`: the 116 only ever cleared the floating
          rail, which is gone; the panel takes real width now. */}
      <div
        data-testid="chat-thread-footer"
        className="mx-auto flex w-full min-h-0 max-w-(--mf-transcript-width) flex-col px-5 pb-4"
      >
        {/* The ONE live timer (D18, reverses #214): the status line sits above
            the gate slot and the composer, not inside the transcript. */}
        <GeneratingIndicator />
        <ChatGateMount />
        <div className="flex min-h-0 flex-col">
          {readOnly ? (
            <p data-testid="chat-read-only-note" className="py-2 text-center text-xs text-muted-foreground">
              Delegated task transcript · read-only
            </p>
          ) : (
            <>
              {variant !== 'side' && <WorktreeSwitchBanner />}
              {variant !== 'side' && <AgentOutboxChip />}
              <ThreadFooterInput variant={variant} />
            </>
          )}
        </div>
      </div>
    </ThreadPrimitive.ViewportFooter>
  );
}
export function ChatThreadViewport({ emptyState, variant }: { emptyState?: ReactNode; variant: ChatThreadVariant }) {
  const readOnly = useAuiState((s) => (s.threadListItem?.custom as SessionCustom | undefined)?.delegation != null);
  const threadId = useSideAwareThreadId();
  const { viewportRef, contentRef, footerRef, viewportElement, beginInteraction, isFollowing } =
    useThreadBottomPin(threadId);
  const scroll = useMemo(
    () => ({ viewportElement, beginInteraction, isFollowing }),
    [viewportElement, beginInteraction, isFollowing],
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
        <ThreadPrimitive.Viewport
          ref={viewportRef}
          autoScroll={false}
          data-testid="chat-thread-viewport"
          data-mf-chat-thread
          data-mf-chat-id={chatId}
          tabIndex={-1}
          className="relative flex flex-1 flex-col overflow-y-auto [overflow-anchor:none]"
        >
          <ChatThreadLoadingSpinner />
          <div ref={contentRef} className="relative mx-auto w-full max-w-(--mf-transcript-width) flex-1 px-5 py-4">
            <TranscriptWidthHandle side="left" rootRef={rootRef} />
            <TranscriptWidthHandle side="right" rootRef={rootRef} />
            <LoadErrorBanner />
            {variant !== 'side' && <ContextNotPreservedNotice />}
            {messageCount === 0 && emptyState != null ? emptyState : null}
            {/* Keyed by thread: the progressive window (and compact mode's caches)
              restart from the new thread's tail on a switch instead of
              inheriting the previous thread's state. */}
            <EarlierMessages />
            <TranscriptMessages key={threadId ?? ''} />
            <CompactingIndicator />
          </div>
          <ThreadFooter variant={variant} readOnly={readOnly} footerRef={footerRef} />
        </ThreadPrimitive.Viewport>
      </div>
    </TranscriptScrollProvider>
  );
}
