/**
 * The rig's transcript state: the loaded window, the run flag, and the edits a
 * scenario makes (a page above, a streamed chunk, a code block that grows, the
 * end of a run). One tiny external store, read by the runtime through
 * `useSyncExternalStore`.
 */
import type { ThreadMessage } from '@assistant-ui/react';
import { buildRealTranscript } from './fixture-real';
import { answerText, buildTranscript, previousPage, userMessage, type Transcript } from './fixture';
import { params } from './params';

export interface RigState {
  messages: readonly ThreadMessage[];
  running: boolean;
  /** `app` only: an older page is in flight (the real `historyWindow.loading`). */
  loading: boolean;
}

export const CHAT_ID = 'rig-chat';
const PREPEND_EVENT = 'mainframe:history-prepend';

function image(index: number) {
  if (index % 7 !== 3) return undefined;
  const hold = params.holdImage === index ? '&hold=1' : '';
  return `${location.origin}/rig-img?id=${index}&delay=${150 + (index % 5) * 120}${hold}`;
}

function createStore() {
  const transcript: Transcript =
    params.shape === 'real' ? buildRealTranscript() : buildTranscript(params.totalTurns, params.groups, { image });
  let start = params.windowItems > 0 ? Math.max(0, transcript.all.length - params.windowItems) : transcript.windowStart;
  let state: RigState = { messages: transcript.all.slice(start), running: false, loading: false };
  const listeners = new Set<() => void>();
  const set = (next: Partial<RigState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  const replace = (id: string, make: (message: ThreadMessage) => ThreadMessage) =>
    set({ messages: state.messages.map((message) => (message.id === id ? make(message) : message)) });
  return {
    transcript,
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set,
    replace,
    hasMore: () => start > 0,
    /** Lands the page before the window, the way `AcpSessionPlane.prependPage` does. */
    prependPage(): number {
      const from = previousPage(transcript.all, start);
      if (from === start) return 0;
      const page = transcript.all.slice(from, start);
      start = from;
      window.dispatchEvent(new CustomEvent(PREPEND_EVENT, { detail: CHAT_ID }));
      set({ messages: [...page, ...state.messages], loading: false });
      return page.length;
    },
    growCode(id: string, index: number, lines: number) {
      replace(id, (message) => ({
        ...message,
        content: [{ type: 'text', text: answerText(index, { image: image(index), codeExtra: lines }) }],
      }));
    },
    sendUser(index: number, text: string) {
      set({ messages: [...state.messages, userMessage(`live-${index}-u`, 1000 + index, text)], running: true });
    },
  };
}

export const store = createStore();
export type RigStore = typeof store;
