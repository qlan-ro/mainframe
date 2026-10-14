import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AssistantRuntimeProvider, ThreadPrimitive, useExternalStoreRuntime } from '@assistant-ui/react';
import { useThreadBottomPin } from '../../src/features/chat/thread/use-thread-bottom-pin';
import { TranscriptScrollProvider } from '../../src/features/chat/thread/transcript-scroll-context';
import { useCompactScrollAnchor } from '../../src/features/chat/messages/compact/use-compact-scroll-anchor';
import { TableFixture } from './table-fixture';
import { WindowFixture } from './window-fixture';

function Disclosure() {
  const [open, setOpen] = useState(false);
  const { rowRef, beforeToggle } = useCompactScrollAnchor(open);
  return (
    <div ref={rowRef}>
      <button
        id="toggle"
        onClick={() => {
          beforeToggle();
          setOpen(!open);
        }}
      >
        Work details
      </button>
      {open && (
        <div id="details" style={{ height: 600 }}>
          Expanded tool output
        </div>
      )}
    </div>
  );
}

function Fixture() {
  const pin = useThreadBottomPin('benchmark');
  const runtime = useExternalStoreRuntime({ messages: [], isRunning: false, onNew: async () => {} });
  const Viewport = location.search.includes('integrated') ? ThreadPrimitive.Viewport : 'div';
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TranscriptScrollProvider value={pin}>
        <Viewport
          id="viewport"
          ref={pin.viewportRef}
          {...(Viewport !== 'div' ? { autoScroll: location.search.includes('baseline') } : {})}
          style={{ height: 400, width: 600, overflowY: 'auto' }}
        >
          <div id="content" ref={pin.contentRef}>
            <div style={{ height: 1200 }}>Earlier messages</div>
            <Disclosure />
            <div id="tail" style={{ height: 100 }}>
              Streaming response
            </div>
          </div>
          <div id="footer" ref={pin.footerRef} style={{ height: 80, position: 'sticky', bottom: 0 }}>
            Composer
          </div>
          {Viewport !== 'div' && (
            <ThreadPrimitive.ScrollToBottom id="bottom" behavior="smooth">
              Latest
            </ThreadPrimitive.ScrollToBottom>
          )}
        </Viewport>
      </TranscriptScrollProvider>
    </AssistantRuntimeProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  location.search.includes('table') ? (
    <TableFixture />
  ) : location.search.includes('windows') ? (
    <WindowFixture />
  ) : (
    <Fixture />
  ),
);
