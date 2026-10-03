import { useMemo } from 'react';
import { ExportedMessageRepository, type ThreadMessage, type ThreadMessageLike } from '@assistant-ui/react';
import type { ChatThreadState } from '../controller/chat-thread-state';
import { projectChatThreadMessages } from '../controller/project-messages';

function nativeMessage(message: ThreadMessageLike, cache: WeakMap<ThreadMessageLike, ThreadMessage>): ThreadMessage {
  const existing = cache.get(message);
  if (existing) return existing;
  const normalized = ExportedMessageRepository.fromArray([message]).messages[0]!.message;
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
