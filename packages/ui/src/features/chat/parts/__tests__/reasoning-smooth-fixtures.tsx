import { createContext, useContext, useMemo } from 'react';
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import {
  AssistantRuntimeProvider,
  ExportedMessageRepository,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessage,
  type ReasoningMessagePartComponent,
} from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ReasoningText } from '../ReasoningText';
import { VerboseParts } from '../../messages/VerboseParts';
import { CompactParts } from '../../messages/compact/CompactParts';
import { TranscriptScopeProvider } from '../../messages/compact/transcript-scope';
import { convertAcpItems } from '../../view-model/convert-acp-item';
import type { AccumulatedItem } from '../../view-model/acp-item-accumulator';
import { createChatThreadState, reduceChatThreadState } from '../../controller/chat-thread-state';
import { projectChatThreadMessages } from '../../controller/project-messages';

export type Mode = 'leaf' | 'verbose' | 'compact';
const ModeContext = createContext<Mode>('leaf');
const PartIndexContext = createContext<number | undefined>(undefined);
export const LONG = 'A'.repeat(80);
export const MORE = 'B'.repeat(80);
export function thought(
  text: string,
  streaming = true,
  id = 'thought',
  origin: 'live' | 'replay' = 'live',
): AccumulatedItem {
  return {
    kind: 'thought',
    id,
    origin,
    content: [{ type: 'text', text }],
    meta: { '_mainframe.dev': { containerId: 'reasoning-message', streaming } },
  };
}
export function messages(items: AccumulatedItem[], running: boolean) {
  let state = createChatThreadState('reasoning-chat');
  state = reduceChatThreadState(state, {
    type: 'transcript.updated',
    messages: convertAcpItems(items, () => new Date(0)),
  });
  state = reduceChatThreadState(state, { type: running ? 'run.started' : 'run.stopped' });
  return projectChatThreadMessages(state);
}
const ReasoningLeaf: ReasoningMessagePartComponent = (part) => (
  <span data-testid="reasoning-leaf">
    <ReasoningText {...part} />
  </span>
);
const leafComponents = { Reasoning: ReasoningLeaf };
function LeafParts() {
  const index = useContext(PartIndexContext);
  if (index !== undefined) return <MessagePrimitive.PartByIndex index={index} components={leafComponents} />;
  return (
    <MessagePrimitive.GroupedParts groupBy={() => []} indicator="never">
      {({ part }) => (part.type === 'reasoning' ? <ReasoningLeaf {...part} /> : null)}
    </MessagePrimitive.GroupedParts>
  );
}
function Assistant() {
  const mode = useContext(ModeContext);
  return (
    <MessagePrimitive.Root data-testid="reasoning-message">
      {mode === 'leaf' ? <LeafParts /> : mode === 'verbose' ? <VerboseParts /> : <CompactParts />}
    </MessagePrimitive.Root>
  );
}
export function Harness({
  items,
  running = true,
  mode = 'leaf',
  rootId = 'reasoning',
  index,
}: {
  items: AccumulatedItem[];
  running?: boolean;
  mode?: Mode;
  rootId?: string;
  index?: number;
}) {
  const repository = useMemo(() => ExportedMessageRepository.fromArray(messages(items, running)), [items, running]);
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messageRepository: repository,
    isRunning: running,
    onNew: async () => {},
  });
  const scope = useMemo(
    () => ({ rootThreadId: rootId, chatId: 'reasoning-chat', ancestors: [], pendingToolIds: new Set<string>() }),
    [rootId],
  );
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>
        <TranscriptScopeProvider value={scope}>
          <ModeContext.Provider value={mode}>
            <PartIndexContext.Provider value={index}>
              <ThreadPrimitive.Root>
                <ThreadPrimitive.Viewport data-testid="reasoning-viewport">
                  <ThreadPrimitive.Messages components={{ AssistantMessage: Assistant, UserMessage: () => null }} />
                </ThreadPrimitive.Viewport>
              </ThreadPrimitive.Root>
            </PartIndexContext.Provider>
          </ModeContext.Provider>
        </TranscriptScopeProvider>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}
export const shown = (index = 0) =>
  document.querySelectorAll('[data-testid="reasoning-leaf"]')[index]?.textContent ?? '';
export const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
export const flush = () => act(async () => void (await new Promise((resolve) => setImmediate(resolve))));
export function startClock() {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
}
export function stopClock() {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
}
