'use client';

/**
 * The composer of the chat a component is in. `aui.composer` is rebound inside a
 * message to that message's edit composer, and a nested sub-agent transcript has
 * a read-only thread of its own; `threads.thread('main')` is the chat column's,
 * which is another chat inside a workspace tab. So `ChatThread` hands its own down.
 */
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { useAui, type AssistantClient } from '@assistant-ui/react';

type ThreadComposer = ReturnType<AssistantClient['thread']['composer']>;

const ThreadComposerContext = createContext<(() => ThreadComposer) | null>(null);

export function ThreadComposerProvider({ children }: { children: ReactNode }) {
  const aui = useAui();
  const get = useCallback(() => aui.thread.composer(), [aui]);
  return <ThreadComposerContext.Provider value={get}>{children}</ThreadComposerContext.Provider>;
}

/** Reads the composer when called; the conversation's outside any `ChatThread`. */
export function useThreadComposer(): () => ThreadComposer {
  const aui = useAui();
  const own = useContext(ThreadComposerContext);
  return useCallback(() => own?.() ?? aui.threads.thread('main').composer(), [own, aui]);
}
