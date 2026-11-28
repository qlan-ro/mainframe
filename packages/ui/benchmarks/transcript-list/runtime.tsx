/** The transcript runtime the app mounts (`useExternalStoreRuntime`), fed by the rig's store. */
import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessage } from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { AcpChatController } from '@/features/chat/controller/acp-chat-controller';
import { createChatThreadState } from '@/features/chat/controller/chat-thread-state';
import { buildChatExtras } from '@/features/chat/runtime/chat-extras';
import { TranscriptScopeProvider } from '@/features/chat/messages/turn/transcript-scope';
import { CHAT_ID, store } from './store';
import { controls } from './controls';

/** No daemon: every controller call is inert, and nothing reads port 31415. */
const controller = new Proxy({}, { get: () => async () => undefined }) as unknown as AcpChatController;

export function RigRuntime({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(store.subscribe, store.get);
  const hasMore = store.hasMore();
  const extras = useMemo(() => {
    const base = createChatThreadState(CHAT_ID);
    const chat = {
      ...base,
      historyWindow: { hasMore, loading: state.loading },
      runState: state.running ? ({ type: 'running' } as const) : base.runState,
    };
    // `loadEarlier` stays undefined: scenarios land pages themselves, at known times.
    return { ...buildChatExtras(controller, 0, chat), loadEarlier: undefined };
  }, [hasMore, state.running, state.loading]);
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messages: state.messages,
    isRunning: state.running,
    extras,
    // `composer=real` sends as the app does (`sendChatMessage`): the prompt row and the run start, then the
    // transcript is told the user sent (`announceUserSend` → the owner's `pinToBottom`), all in the send's task.
    onNew: async (message) => {
      const text = message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
      store.sendUser(4242, text);
      controls.jump();
    },
  });
  const scope = useMemo(
    () => ({ rootThreadId: CHAT_ID, chatId: CHAT_ID, ancestors: [], pendingToolIds: new Set<string>() }),
    [],
  );
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>
        <TranscriptScopeProvider value={scope}>{children}</TranscriptScopeProvider>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}
