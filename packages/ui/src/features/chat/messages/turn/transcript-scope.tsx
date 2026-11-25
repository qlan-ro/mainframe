import { createContext, useContext, useId, useMemo, type ReactNode } from 'react';
import { useSideAwareThreadId } from '@/features/side-chat/side-chat-scope';
import { useChatExtras } from '../../runtime/chat-extras';

export interface TranscriptScope {
  rootThreadId: string;
  chatId?: string;
  messageId?: string;
  ancestors: readonly string[];
  pendingToolIds: ReadonlySet<string>;
  /** Whether these messages' work can still be going. Left out: yes. */
  live?: boolean;
}
const empty: TranscriptScope = { rootThreadId: '', ancestors: [], pendingToolIds: new Set() };
const Context = createContext<TranscriptScope>(empty);
export const TranscriptScopeProvider = Context.Provider;
export const useTranscriptScope = () => useContext(Context);

export function RootTranscriptScope({ children }: { children: ReactNode }) {
  const threadId = useSideAwareThreadId();
  const extras = useChatExtras();
  const fallback = useId();
  const chatId = extras?.state.chatId;
  const permissions = extras?.permissions;
  const pendingToolIds = useMemo(
    () =>
      new Set(
        Object.values(permissions ?? {}).flatMap((entry) => (entry.request.toolUseId ? [entry.request.toolUseId] : [])),
      ),
    [permissions],
  );
  const value = useMemo(
    () => ({
      rootThreadId: threadId ?? chatId ?? fallback,
      chatId,
      ancestors: [],
      pendingToolIds,
    }),
    [threadId, chatId, fallback, pendingToolIds],
  );
  return <TranscriptScopeProvider value={value}>{children}</TranscriptScopeProvider>;
}

export interface NestedScope {
  messageId: string;
  toolCallId: string;
  /** Whether the agent whose transcript this is still works. */
  live: boolean;
  /** A delegated task's own chat, and the requests pending in it. A sub-agent's are its parent's. */
  chatId?: string;
  pendingToolIds?: ReadonlySet<string>;
}

export function NestedTranscriptScope({
  messageId,
  toolCallId,
  live,
  chatId,
  pendingToolIds,
  children,
}: NestedScope & { children: ReactNode }) {
  const parent = useTranscriptScope();
  const value = useMemo(
    () => ({
      ...parent,
      live,
      chatId: chatId ?? parent.chatId,
      pendingToolIds: pendingToolIds ?? parent.pendingToolIds,
      ancestors: [...parent.ancestors, JSON.stringify([messageId, toolCallId])],
    }),
    [parent, messageId, toolCallId, live, chatId, pendingToolIds],
  );
  return <TranscriptScopeProvider value={value}>{children}</TranscriptScopeProvider>;
}
