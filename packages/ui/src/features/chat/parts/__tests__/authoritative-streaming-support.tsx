import { createContext, useContext, useMemo } from 'react';
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import {
  AssistantRuntimeProvider,
  AuiConfig,
  AuiProvider,
  ExternalThread,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useExternalStoreRuntime,
  type ThreadMessage,
} from '@assistant-ui/react';
import { MarkdownText } from '../markdown-text';
import { convertAcpItems } from '../../view-model/convert-acp-item';
import type { AccumulatedItem } from '../../view-model/acp-item-accumulator';
import { createChatThreadState, reduceChatThreadState, type ChatThreadState } from '../../controller/chat-thread-state';
import { projectChatThreadMessages, projectChatThreadRepository } from '../../controller/project-messages';
import { isRunningFromState } from '../../runtime/chat-extras';

const Remount = createContext(0);
function Assistant() {
  const epoch = useContext(Remount);
  const id = useAuiState((state) => state.message.id);
  return (
    <MessagePrimitive.Root data-testid={`message-${id}`}>
      <MessagePrimitive.GroupedParts groupBy={() => []} indicator="never">
        {({ part }) => (part.type === 'text' ? <MarkdownText key={epoch} {...part} /> : null)}
      </MessagePrimitive.GroupedParts>
    </MessagePrimitive.Root>
  );
}
const components = { AssistantMessage: Assistant, UserMessage: () => null };
function Transcript({ epoch }: { epoch: number }) {
  const running = useAuiState((state) => state.thread.isRunning);
  return (
    <Remount.Provider value={epoch}>
      <output data-testid="thread-running">{String(running)}</output>
      <ThreadPrimitive.Messages components={components} />
    </Remount.Provider>
  );
}
export interface HarnessProps {
  state: ChatThreadState;
  epoch?: number;
}
export function MainHarness({ state, epoch = 0 }: HarnessProps) {
  const repository = useMemo(() => projectChatThreadRepository(state), [state]);
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messageRepository: repository,
    isRunning: isRunningFromState(state),
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Transcript epoch={epoch} />
    </AssistantRuntimeProvider>
  );
}
function SplitThread({ state, epoch = 0 }: HarnessProps) {
  const aui = useAui();
  const config = useMemo(
    () =>
      AuiConfig({
        thread: ExternalThread({
          messages: projectChatThreadMessages(state),
          isRunning: isRunningFromState(state),
          onNew: async () => {},
        }),
      }),
    [state],
  );
  return (
    <AuiProvider extends={aui} config={config}>
      <Transcript epoch={epoch} />
    </AuiProvider>
  );
}
export function SplitHarness(props: HarnessProps) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({ messages: [], isRunning: false, onNew: async () => {} });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SplitThread {...props} />
    </AssistantRuntimeProvider>
  );
}
export const OLD = 'A'.repeat(80);
export const NEW = 'B'.repeat(80);
export const TAIL = 'C'.repeat(80);
export function textItem(id: string, text: string, streaming = false): AccumulatedItem {
  return {
    kind: 'message',
    id,
    role: 'agent',
    origin: 'live',
    content: [{ type: 'text', text }],
    meta: { '_mainframe.dev': { containerId: id, ...(streaming ? { streaming: true } : {}) } },
  };
}
export function stateFromItems(items: AccumulatedItem[], phase: 'idle' | 'running' = 'idle'): ChatThreadState {
  let state = createChatThreadState('chat');
  state = reduceChatThreadState(state, { type: 'capabilities.updated', authoritativeItemStreaming: true });
  state = reduceChatThreadState(state, {
    type: 'transcript.updated',
    messages: convertAcpItems(items, () => new Date(0)),
  });
  return reduceChatThreadState(state, { type: phase === 'idle' ? 'run.stopped' : 'run.started' });
}
export function nextTurn(state: ChatThreadState, mode: 'pending' | 'echo' | 'cancelling') {
  let next = reduceChatThreadState(state, { type: 'run.started' });
  if (mode === 'echo') return withAcknowledgment(next);
  next = reduceChatThreadState(next, {
    type: 'local.message.queued',
    pending: {
      clientId: 'next',
      chatId: 'chat',
      text: 'next prompt',
      createdAt: 1,
      status: 'pending',
    },
  });
  return mode === 'cancelling' ? reduceChatThreadState(next, { type: 'run.cancelling' }) : next;
}
export function withAcknowledgment(state: ChatThreadState) {
  return reduceChatThreadState(state, {
    type: 'transcript.updated',
    messages: [...state.messages, { id: 'ack', role: 'user', content: [{ type: 'text', text: 'next prompt' }] }],
  });
}
export const textNode = (id: string) => document.querySelector(`[data-testid="message-${id}"] [data-status]`)!;
export const shown = (id: string) => textNode(id).textContent ?? '';
export const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
export const flush = () => act(async () => void (await new Promise((resolve) => setImmediate(resolve))));
export function startClock() {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
}
export function stopClock() {
  window.getSelection()?.removeAllRanges();
  vi.useRealTimers();
}
