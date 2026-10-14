import { StrictMode, useMemo, useState } from 'react';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  type ThreadMessage,
} from '@assistant-ui/react';
import { ProgressiveMessages } from '../../src/features/chat/thread/ProgressiveMessages';
import { useThreadBottomPin } from '../../src/features/chat/thread/use-thread-bottom-pin';
import { CompactWindow, compactMessages } from './compact-window';

function Message() {
  const id = useAuiState((s) => s.message.id);
  return (
    <div data-row={id} style={{ padding: 12, borderBottom: '1px solid gray' }}>
      {id}: {'Transcript content that wraps as the window changes size. '.repeat(8)}
    </div>
  );
}
const components = { AssistantMessage: Message, UserMessage: Message };
const compact = location.search.includes('compact');

function useWindowMessages(thread: string, loaded: boolean) {
  return useMemo<ThreadMessage[]>(
    () =>
      !loaded
        ? []
        : compact
          ? compactMessages(thread.startsWith('long') ? (location.search.includes('complex') ? 400 : 160) : 5)
          : Array.from(
              { length: thread.startsWith('long') ? (location.search.includes('complex') ? 400 : 160) : 5 },
              (_, i) => ({
                id: `${thread}-${i}`,
                role: 'user',
                content: [{ type: 'text', text: `Message ${i}` }],
                createdAt: new Date(0),
                attachments: [],
                metadata: { custom: {} },
              }),
            ),
    [thread, loaded],
  );
}

function WindowThread({ thread, loaded }: { thread: string; loaded: boolean }) {
  const pin = useThreadBottomPin(thread);
  const messages = useWindowMessages(thread, loaded);
  const runtime = useExternalStoreRuntime({ messages, isRunning: false, onNew: async () => {} });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div style={{ height: 400, containerType: 'size' }}>
        <ThreadPrimitive.Viewport
          id="viewport"
          ref={pin.viewportRef}
          autoScroll={false}
          style={{ height: '100%', width: '100%', overflowY: 'auto' }}
        >
          <div id="content" ref={pin.contentRef}>
            {compact ? (
              <CompactWindow key={thread} thread={thread} pin={pin} />
            ) : (
              <ProgressiveMessages key={thread} components={components} />
            )}
          </div>
          <div ref={pin.footerRef} style={{ height: 60, position: 'sticky', bottom: 0, background: 'white' }}>
            Composer
          </div>
        </ThreadPrimitive.Viewport>
      </div>
    </AssistantRuntimeProvider>
  );
}

export function WindowFixture() {
  const [open, setOpen] = useState(true);
  const [visible, setVisible] = useState(true);
  const [loaded, setLoaded] = useState(true);
  const [thread, setThread] = useState('long');
  return (
    <StrictMode>
      <button id="mount" onClick={() => setOpen(!open)}>
        Close/reopen
      </button>
      <button id="visible" onClick={() => setVisible(!visible)}>
        Hide/show
      </button>
      <button id="loaded" onClick={() => setLoaded(!loaded)}>
        Clear/load history
      </button>
      <button id="switch" onClick={() => setThread(thread === 'long' ? 'short' : 'long')}>
        Switch chat
      </button>
      <button id="switch-long" onClick={() => setThread(thread === 'long' ? 'long-other' : 'long')}>
        Switch long chat
      </button>
      <div id="window" style={{ width: 640, display: visible ? 'block' : 'none' }}>
        {open && <WindowThread thread={thread} loaded={loaded} />}
      </div>
    </StrictMode>
  );
}
