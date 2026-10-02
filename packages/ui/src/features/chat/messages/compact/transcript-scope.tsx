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
  const value = useMemo(
    () => ({
      rootThreadId: threadId ?? extras?.state.chatId ?? fallback,
      chatId: extras?.state.chatId,
      ancestors: [],
      pendingToolIds: new Set(
        Object.values(extras?.permissions ?? {}).flatMap((entry) =>
          entry.request.toolUseId ? [entry.request.toolUseId] : [],
        ),
      ),
    }),
    [threadId, extras, fallback],
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
