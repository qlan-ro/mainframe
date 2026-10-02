import { createContext, useContext, useId, useMemo, type ReactNode } from 'react';
import { useSideAwareThreadId } from '@/features/side-chat/side-chat-scope';
import { useChatExtras } from '../../runtime/chat-extras';

export interface TranscriptScope {
  rootThreadId: string;
  chatId?: string;
  messageId?: string;
  ancestors: readonly string[];
  pendingToolIds: ReadonlySet<string>;
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

export function NestedTranscriptScope({
  messageId,
  toolCallId,
  children,
}: {
  messageId: string;
  toolCallId: string;
  children: ReactNode;
}) {
  const parent = useTranscriptScope();
  const value = useMemo(
    () => ({ ...parent, ancestors: [...parent.ancestors, JSON.stringify([messageId, toolCallId])] }),
    [parent, messageId, toolCallId],
  );
  return <TranscriptScopeProvider value={value}>{children}</TranscriptScopeProvider>;
}
