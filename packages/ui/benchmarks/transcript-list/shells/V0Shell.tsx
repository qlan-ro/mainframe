/** v0: today's stack, composed as `ChatThreadViewport` composes it (pin, prepend anchor, virtualizer, aui viewport). */
import { useEffect, useMemo, useState } from 'react';
import { ThreadPrimitive } from '@assistant-ui/react';
import { EarlierMessages } from '@/features/chat/thread/EarlierMessages';
import { TurnTranscript } from '@/features/chat/messages/turn/TurnTranscript';
import { TranscriptScrollProvider } from '@/features/chat/thread/transcript-scroll-context';
import { TranscriptScrollToBottom } from '@/features/chat/thread/TranscriptScrollToBottom';
import { useThreadBottomPin } from '@/features/chat/thread/use-thread-bottom-pin';
import { useElementHeight } from '@/features/chat/thread/use-element-height';
import { controls } from '../controls';
import { CHAT_ID } from '../store';
import { ComposerStub } from './ComposerStub';

export function V0Shell() {
  const pin = useThreadBottomPin(CHAT_ID);
  const { viewportElement, viewport, beginInteraction, isFollowing, isInteracting } = pin;
  const scroll = useMemo(
    () => ({ viewportElement, viewport, beginInteraction, isFollowing, isInteracting }),
    [viewportElement, viewport, beginInteraction, isFollowing, isInteracting],
  );
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const footerHeight = useElementHeight(footer);
  const [overlayHost, setOverlayHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    controls.viewport = viewport;
    controls.jump = () => document.querySelector<HTMLButtonElement>('[data-testid="chat-scroll-to-bottom"]')?.click();
  }, [viewport]);
  return (
    <TranscriptScrollProvider value={scroll}>
      <div className="relative flex min-h-0 flex-1 flex-col [container-type:size]">
        <ThreadPrimitive.Viewport
          ref={pin.viewportRef}
          autoScroll={false}
          scrollToBottomOnThreadSwitch={false}
          data-mf-chat-thread
          data-mf-chat-id={CHAT_ID}
          data-rig-viewport
          tabIndex={-1}
          className="relative flex flex-1 flex-col overflow-y-auto [overflow-anchor:none]"
        >
          <div
            ref={pin.contentRef}
            className="relative mx-auto w-[calc(100%-0.5rem)] max-w-(--mf-transcript-width) flex-1 px-5 py-4"
          >
            <EarlierMessages />
            <TurnTranscript key={CHAT_ID} />
          </div>
          <div
            ref={(node) => {
              pin.footerRef(node);
              setFooter(node);
            }}
            className="sticky bottom-0 mt-auto flex shrink-0 flex-col bg-background"
          >
            <ComposerStub />
          </div>
          <TranscriptScrollToBottom host={overlayHost} footerHeight={footerHeight} />
        </ThreadPrimitive.Viewport>
        <div ref={setOverlayHost} className="pointer-events-none absolute inset-0" />
      </div>
    </TranscriptScrollProvider>
  );
}
