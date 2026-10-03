import { useMemo } from 'react';
import type { ThreadMessage, ThreadMessageLike } from '@assistant-ui/react';
import { normalizeNativeRepository } from '../view-model/normalize-native-messages';
import type { ChatThreadState } from '../controller/chat-thread-state';
import { projectChatThreadMessages } from '../controller/project-messages';

function nativeMessage(message: ThreadMessageLike, cache: WeakMap<ThreadMessageLike, ThreadMessage>): ThreadMessage {
  const existing = cache.get(message);
  if (existing) return existing;
  const normalized = normalizeNativeRepository([message]).messages[0]!.message;
  cache.set(message, normalized);
  return normalized;
}

export function useNativeThreadMessages(state: ChatThreadState): ThreadMessage[] {
  const cache = useMemo(() => new WeakMap<ThreadMessageLike, ThreadMessage>(), []);
  return useMemo(
    () =>
      projectChatThreadMessages({ ...state, messages: state.messages.map((message) => nativeMessage(message, cache)) }),
    [state, cache],
  );
}
