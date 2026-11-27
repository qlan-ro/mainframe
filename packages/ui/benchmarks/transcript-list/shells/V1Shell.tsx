/** v1: plain rows, browser anchoring on, the hand-written owner, the composer outside the scroller. */
import { useEffect } from 'react';
import { EarlierMessages } from '@/features/chat/thread/EarlierMessages';
import { TurnTranscript } from '@/features/chat/messages/turn/TurnTranscript';
import { controls } from '../controls';
import { CHAT_ID } from '../store';
import { ComposerStub } from './ComposerStub';
import { useScrollOwner } from './scroll-owner';

export function V1Shell() {
  const owner = useScrollOwner();
  useEffect(() => {
    controls.viewport = owner.viewportRef.current;
    controls.jump = owner.jump;
  }, [owner.viewportRef, owner.jump]);
  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={owner.viewportRef}
          data-mf-chat-thread
          data-mf-chat-id={CHAT_ID}
          data-rig-viewport
          tabIndex={-1}
          className="relative flex flex-1 flex-col overflow-y-auto"
        >
          <div
            ref={owner.contentRef}
            className="relative mx-auto w-[calc(100%-0.5rem)] max-w-(--mf-transcript-width) flex-1 px-5 py-4"
          >
            <EarlierMessages />
            <TurnTranscript key={CHAT_ID} />
          </div>
        </div>
      </div>
      <ComposerStub />
    </>
  );
}
