/**
 * The loaded sessions (regular and archived) as `SessionItem`s, for the
 * orchestration surfaces that look other chats up by id: the tasks chip, the
 * `delegate_task` card, and the agent-outbox chip. Re-derived only when the
 * session list itself changes.
 */
import { useMemo } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { threadItemsToSessionItems, type SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';

export function useSessionItems(): SessionItem[] {
  const threadItems = useAuiState((s) => s.threads.threadItems);
  return useMemo(() => threadItemsToSessionItems(threadItems), [threadItems]);
}

/** A chat by its daemon id: a thread created this app-run keeps a local item id and carries the chat id as `remoteId`. */
export function findSession(items: readonly SessionItem[], chatId: string): SessionItem | undefined {
  return items.find((it) => (it.remoteId ?? it.id) === chatId);
}

/**
 * A chat's title by its daemon id, or undefined when the chat isn't loaded or
 * has no title yet. Selects the string alone, so a caller re-renders only when
 * that title changes, not on every session-list update.
 */
export function useChatTitle(chatId: string): string | undefined {
  return useAuiState((s) => {
    const title = s.threads.threadItems.find((it) => (it.remoteId ?? it.id) === chatId)?.title?.trim();
    return title || undefined;
  });
}
