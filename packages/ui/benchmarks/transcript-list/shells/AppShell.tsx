/**
 * app: the list as the app ships it behind Settings > Chat > plain transcript list. The real scroll owner
 * (`features/chat/thread/use-scroll-owner.ts`), the real plain list with its tail-first mount
 * (`PlainMessages`), the real boundary row (`EarlierMessages`, with its loading state) and the real
 * `TurnTranscript`, in a viewport laid out as `OwnedChatThreadViewport` lays it out, with the app's trim at the tail
 * (`use-trim-at-tail.ts`). Only the composer is a stub.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { EarlierMessages } from '@/features/chat/thread/EarlierMessages';
import { TurnTranscript } from '@/features/chat/messages/turn/TurnTranscript';
import { TranscriptScrollProvider } from '@/features/chat/thread/transcript-scroll-context';
import { TranscriptEdgeFades } from '@/features/chat/thread/TranscriptEdgeFades';
import { useScrollOwner } from '@/features/chat/thread/use-scroll-owner';
import { useTrimAtTail } from '@/features/chat/thread/use-trim-at-tail';
import { controls } from '../controls';
import { CHAT_ID, store } from '../store';
import { ComposerStub } from './ComposerStub';

const trimWindow = () => void store.trimToNewestPage();

export function AppShell() {
  // A switch away and back (`scenarios/switch-back.ts`) changes the thread, as the app's chat column does.
  const thread = useSyncExternalStore(store.subscribe, () => store.get().thread);
  const owner = useScrollOwner(thread, CHAT_ID);
  const { viewport } = owner.controller;
  // The app's own hook; the rig's store cuts the window as `AcpHistory.trim` does.
  useTrimAtTail(owner, trimWindow, false);
  useEffect(() => {
    controls.viewport = viewport ?? null;
    controls.jump = owner.pinToBottom;
    controls.isFollowing = owner.controller.isFollowing;
  }, [viewport, owner.pinToBottom, owner.controller.isFollowing]);
  return (
    <TranscriptScrollProvider value={owner.controller}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={owner.setViewport}
            data-mf-chat-thread
            data-mf-chat-id={CHAT_ID}
            data-rig-viewport
            data-scrollbar="none"
            tabIndex={-1}
            className="relative flex min-h-0 flex-1 flex-col overflow-y-auto"
          >
            <div
              ref={owner.setContent}
              className="relative mx-auto w-[calc(100%-0.5rem)] max-w-(--mf-transcript-width) flex-1 px-5 py-4"
            >
              <EarlierMessages />
              {thread !== 'away' && <TurnTranscript key={thread} />}
            </div>
          </div>
          <TranscriptEdgeFades />
        </div>
        {/* As `ThreadFooter` sits under the app's viewport: the owner samples what changes in it (#519). */}
        <div ref={owner.setFooter} className="flex shrink-0 flex-col">
          <ComposerStub />
        </div>
      </div>
    </TranscriptScrollProvider>
  );
}
