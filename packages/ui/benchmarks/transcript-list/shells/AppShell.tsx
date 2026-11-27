/**
 * app: the list as the app ships it behind Settings > Chat > plain transcript list. The real scroll owner
 * (`features/chat/thread/use-scroll-owner.ts`), the real plain list with its tail-first mount
 * (`PlainMessages`), the real boundary row (`EarlierMessages`, with its loading state) and the real
 * `TurnTranscript`, in a viewport laid out as `OwnedChatThreadViewport` lays it out. Only the composer is a stub.
 */
import { useEffect } from 'react';
import { EarlierMessages } from '@/features/chat/thread/EarlierMessages';
import { TurnTranscript } from '@/features/chat/messages/turn/TurnTranscript';
import { TranscriptScrollProvider } from '@/features/chat/thread/transcript-scroll-context';
import { useScrollOwner } from '@/features/chat/thread/use-scroll-owner';
import { controls } from '../controls';
import { CHAT_ID } from '../store';
import { ComposerStub } from './ComposerStub';

export function AppShell() {
  const owner = useScrollOwner(CHAT_ID, CHAT_ID);
  const { viewport } = owner.controller;
  useEffect(() => {
    controls.viewport = viewport ?? null;
    controls.jump = owner.pinToBottom;
  }, [viewport, owner.pinToBottom]);
  return (
    <TranscriptScrollProvider value={owner.controller}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={owner.setViewport}
          data-mf-chat-thread
          data-mf-chat-id={CHAT_ID}
          data-rig-viewport
          data-scrollbar="none"
          tabIndex={-1}
          className="scroll-fade-y relative flex min-h-0 flex-1 flex-col overflow-y-auto"
        >
          <div
            ref={owner.setContent}
            className="relative mx-auto w-[calc(100%-0.5rem)] max-w-(--mf-transcript-width) flex-1 px-5 py-4"
          >
            <EarlierMessages />
            <TurnTranscript key={CHAT_ID} />
          </div>
        </div>
        <ComposerStub />
      </div>
    </TranscriptScrollProvider>
  );
}
