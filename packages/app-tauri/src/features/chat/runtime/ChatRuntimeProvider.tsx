/**
 * ChatRuntimeProvider — Phase 1 seam.
 *
 * Wires the per-chat WS subscriber to assistant-ui's `useExternalStoreRuntime`.
 * The daemon is the single source of truth; this component holds NO message
 * cache beyond the live useSyncExternalStore snapshot.
 *
 * Outbound:
 *  - onNew  → WS message.send (fire-and-forget; daemon echoes the message back)
 *  - onCancel → POST /api/chats/:id/interrupt
 *
 * Phase 2 additions: attachment upload, permission response, optimistic dedup,
 * thread-list adapter. None change the store-less design.
 */
import { useCallback, useContext, createContext } from 'react';
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage } from '@assistant-ui/react';
import { useChatSubscriber } from '../../../lib/daemon/use-chat-subscriber';
import { daemonWs } from '../../../lib/daemon/ws-client';
import { interruptChat } from '../../../lib/api/chats';
import { convertMessage } from '../view-model/convert-message';
import type { ControlRequest } from '@qlan-ro/mainframe-types';

interface ChatRuntimeContextValue {
  chatId: string;
  /** Permission is driven by daemon events — Phase 1 surfaces it as-is for the banner. */
  pendingPermission: ControlRequest | undefined;
}

const ChatRuntimeContext = createContext<ChatRuntimeContextValue | null>(null);

export function useChatRuntime(): ChatRuntimeContextValue {
  const ctx = useContext(ChatRuntimeContext);
  if (!ctx) throw new Error('useChatRuntime must be used inside ChatRuntimeProvider');
  return ctx;
}

interface ChatRuntimeProviderProps {
  chatId: string;
  daemonPort: number;
  children: React.ReactNode;
}

export function ChatRuntimeProvider({ chatId, daemonPort, children }: ChatRuntimeProviderProps) {
  const { messages, isRunning } = useChatSubscriber(chatId, daemonPort);

  const onNew = useCallback(
    async (message: AppendMessage): Promise<void> => {
      const textPart = message.content.find((p) => p.type === 'text');
      const text = textPart?.type === 'text' ? textPart.text.trim() : '';
      if (!text) return;
      daemonWs.send({ type: 'message.send', chatId, content: text });
    },
    [chatId],
  );

  const onCancel = useCallback(async (): Promise<void> => {
    await interruptChat(daemonPort, chatId).catch((err) => console.warn('[chat-runtime] interruptChat failed', err));
  }, [chatId, daemonPort]);

  const runtime = useExternalStoreRuntime({
    isRunning,
    messages,
    convertMessage,
    onNew,
    onCancel,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatRuntimeContext.Provider value={{ chatId, pendingPermission: undefined }}>
        {children}
      </ChatRuntimeContext.Provider>
    </AssistantRuntimeProvider>
  );
}
