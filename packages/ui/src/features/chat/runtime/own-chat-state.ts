/**
 * The state of the chat a transcript is of, where no thread is bound for it: a
 * sub-agent's tab, and a delegated task's steps inside its row. Elsewhere it is
 * the bound thread's.
 */
import { createContext, useContext } from 'react';
import type { ChatThreadState } from '../controller/chat-thread-state';
import { useChatExtrasSelector } from './chat-extras';

const Context = createContext<ChatThreadState | null>(null);
export const OwnChatStateProvider = Context.Provider;

export function useOwnChatState<T>(select: (state: ChatThreadState) => T): T | undefined {
  const own = useContext(Context);
  const bound = useChatExtrasSelector((extras) => (own === null && extras ? select(extras.state) : undefined));
  return own === null ? bound : select(own);
}
