// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AssistantRuntimeProvider,
  useAuiState,
  useExternalStoreRuntime,
  type ThreadMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import type { AcpChatController } from '../../controller/acp-chat-controller';
import {
  createChatThreadState,
  reduceChatThreadState,
  type ChatStateEvent,
  type ChatThreadState,
} from '../../controller/chat-thread-state';
import { TranscriptProjector } from '../../controller/transcript-projector';
import { buildChatExtras } from '../chat-extras';

/** A real thread state behind the controller's own store interface, driven by the real reducer. */
const store = vi.hoisted(() => ({ controller: undefined as unknown }));
vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: { get: () => store.controller },
}));
import { useLiveMessages } from '../use-live-messages';
import { useGateQueue } from '../../gates/use-gate-queue';
import { useTaskResult } from '../../orchestration/use-task-result';

function createStore() {
  let state: ChatThreadState = createChatThreadState('chat');
  const listeners = new Set<() => void>();
  return {
    dispatch(event: ChatStateEvent) {
      state = reduceChatThreadState(state, event);
      listeners.forEach((listener) => listener());
    },
    getState: () => state,
    subscribeState(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let chat: ReturnType<typeof createStore>;
const counts = { task: 0, gate: 0, probe: 0, reader: 0 };

const text = (id: string, body: string): ThreadMessageLike => ({
  id,
  role: 'assistant',
  content: [{ type: 'text', text: body }],
});

const noController = new Proxy({}, { get: () => async () => undefined }) as unknown as AcpChatController;

function Runtime({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(chat.subscribeState, chat.getState);
  const projector = useMemo(() => new TranscriptProjector(), []);
  const messages = useMemo<ThreadMessage[]>(
    () => projector.projectMessages(state, state.windowMessages ?? state.messages),
    // Only the transcript decides the thread's messages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projector, state.messages, state.windowMessages],
  );
  const extras = useMemo(() => buildChatExtras(noController, 0, createChatThreadState('chat')), []);
  const runtime = useExternalStoreRuntime<ThreadMessage>({ messages, isRunning: false, extras, onNew: async () => {} });
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

function Task() {
  counts.task++;
  useTaskResult('no-such-task');
  return null;
}
function Gate() {
  counts.gate++;
  useGateQueue();
  return null;
}
/** A reader whose answer changes with the live transcript: how many messages it holds. */
function Reader() {
  counts.reader++;
  const length = useLiveMessages((messages) => messages.length);
  return <span data-testid="reader">{length}</span>;
}
/** Proves the thread's own messages did change: it re-renders with them. */
function Probe() {
  counts.probe++;
  const last = useAuiState((s) => {
    const content = s.thread.messages[s.thread.messages.length - 1]?.content[0];
    return content?.type === 'text' ? content.text : '';
  });
  return <span data-testid="last">{last}</span>;
}

const mounted = (
  <Runtime>
    <Task />
    <Gate />
    <Probe />
  </Runtime>
);

function stream(frames: number) {
  for (let i = 1; i <= frames; i++) {
    act(() => chat.dispatch({ type: 'transcript.updated', messages: [text('m1', `streamed ${i}`)] }));
  }
}

beforeEach(() => {
  chat = createStore();
  store.controller = chat;
  Object.assign(counts, { task: 0, gate: 0, probe: 0, reader: 0 });
  chat.dispatch({ type: 'transcript.updated', messages: [text('m1', 'start')] });
});
afterEach(() => vi.restoreAllMocks());

describe('consumers of the live transcript while it streams', () => {
  it('at the tail, a task result that is unchanged and a gate queue with nothing pending do not re-render per frame', () => {
    const view = render(mounted);
    const settled = { task: counts.task, gate: counts.gate, probe: counts.probe };
    stream(8);
    expect(view.getByTestId('last').textContent).toBe('streamed 8');
    expect(counts.probe).toBeGreaterThan(settled.probe);
    expect(counts.task).toBe(settled.task);
    expect(counts.gate).toBe(settled.gate);
  });

  it('away from the tail, they still do not, and each frame is projected once for all of them', () => {
    const view = render(mounted);
    act(() => chat.dispatch({ type: 'window.updated', messages: [text('w1', 'a jump window')] }));
    expect(view.getByTestId('last').textContent).toBe('a jump window');
    const settled = { task: counts.task, gate: counts.gate };
    const project = vi.spyOn(TranscriptProjector.prototype, 'projectMessages');
    stream(8);
    expect(view.getByTestId('last').textContent).toBe('a jump window');
    expect(counts.task).toBe(settled.task);
    expect(counts.gate).toBe(settled.gate);
    // The runtime projects the thread's messages once a frame, and the readers one shared live projection.
    expect(project.mock.calls.length).toBeLessThanOrEqual(2 * 8);
  });

  it('back at the tail, the readers follow the thread again without re-rendering either', () => {
    const view = render(mounted);
    act(() => chat.dispatch({ type: 'window.updated', messages: [text('w1', 'a jump window')] }));
    act(() => chat.dispatch({ type: 'window.updated', messages: null }));
    const settled = { task: counts.task, gate: counts.gate };
    stream(4);
    expect(view.getByTestId('last').textContent).toBe('streamed 4');
    expect(counts.task).toBe(settled.task);
    expect(counts.gate).toBe(settled.gate);
  });

  it('away from the tail, a reader whose answer changes re-renders once and shows the live value, then the thread’s again', () => {
    const view = render(
      <Runtime>
        <Reader />
        <Probe />
      </Runtime>,
    );
    expect(view.getByTestId('reader').textContent).toBe('1');
    act(() => chat.dispatch({ type: 'window.updated', messages: [text('w1', 'a jump window')] }));
    const settled = counts.reader;
    // A frame that adds a live message: the thread still shows the window (one message), the chat has two.
    act(() => chat.dispatch({ type: 'transcript.updated', messages: [text('m1', 'start'), text('m2', 'next')] }));
    expect(view.getByTestId('last').textContent).toBe('a jump window');
    expect(view.getByTestId('reader').textContent).toBe('2');
    expect(counts.reader - settled).toBe(1);
    // Frames that change nothing it reads leave it alone.
    act(() => chat.dispatch({ type: 'transcript.updated', messages: [text('m1', 'start'), text('m2', 'next more')] }));
    expect(counts.reader - settled).toBe(1);
    // Back at the tail it reads the thread's own messages, which are the live ones again.
    act(() => chat.dispatch({ type: 'window.updated', messages: null }));
    expect(view.getByTestId('reader').textContent).toBe('2');
    act(() =>
      chat.dispatch({ type: 'transcript.updated', messages: [text('m1', 'a'), text('m2', 'b'), text('m3', 'c')] }),
    );
    expect(view.getByTestId('reader').textContent).toBe('3');
  });
});
