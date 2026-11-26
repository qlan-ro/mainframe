/** v1s: plain rows under shadcn's Message Scroller (`@shadcn/react` 0.3.1) as the scroll owner. */
import { useEffect, useRef } from 'react';
import { MessageScroller, useMessageScroller } from '@shadcn/react/message-scroller';
import { EarlierMessages } from '@/features/chat/thread/EarlierMessages';
import { TurnTranscript } from '@/features/chat/messages/turn/TurnTranscript';
import { controls } from '../controls';
import { CHAT_ID } from '../store';
import { ComposerStub } from './ComposerStub';

function Controls({ viewport }: { viewport: React.RefObject<HTMLDivElement | null> }) {
  const scroller = useMessageScroller();
  useEffect(() => {
    controls.viewport = viewport.current;
    controls.jump = () => void scroller.scrollToEnd({ behavior: 'auto' });
  }, [scroller, viewport]);
  return null;
}

export function V1sShell() {
  const viewport = useRef<HTMLDivElement>(null);
  return (
    <>
      <MessageScroller.Provider autoScroll defaultScrollPosition="end">
        <MessageScroller.Root className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <MessageScroller.Viewport
            ref={viewport}
            data-mf-chat-thread
            data-mf-chat-id={CHAT_ID}
            data-rig-viewport
            className="flex flex-1 flex-col overflow-y-auto"
          >
            {/* Bottom padding lives on the scroller's Content (lists/scroller-rows.tsx): it follows the last item's end. */}
            <div className="relative mx-auto w-[calc(100%-0.5rem)] max-w-(--mf-transcript-width) flex-1 px-5 pt-4">
              <EarlierMessages />
              <TurnTranscript key={CHAT_ID} />
            </div>
          </MessageScroller.Viewport>
          <MessageScroller.Button
            behavior="auto"
            className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full border bg-background px-3 py-1 text-sm inert:opacity-0"
          >
            Jump to latest
          </MessageScroller.Button>
        </MessageScroller.Root>
        <Controls viewport={viewport} />
      </MessageScroller.Provider>
      <ComposerStub />
    </>
  );
}
