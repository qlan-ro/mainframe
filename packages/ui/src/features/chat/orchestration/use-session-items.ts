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

/**
 * A thread by its daemon chat id. A thread created this app-run keeps a local
 * `__LOCALID_*` item carrying the chat id as `remoteId`, and the next list
 * reload adds the canonical item (`id` = chat id) beside it. Only the
 * canonical item picks up later list data such as the daemon's auto-title,
 * so it wins; the local item is the fallback until that reload lands.
 */
export function findByChatId<T extends { id: string; remoteId?: string | undefined }>(
  items: readonly T[],
  chatId: string,
): T | undefined {
  return items.find((it) => it.id === chatId) ?? items.find((it) => it.remoteId === chatId);
}

export function findSession(items: readonly SessionItem[], chatId: string): SessionItem | undefined {
  return findByChatId(items, chatId);
}

/**
 * A chat's title by its daemon id, or undefined when the chat isn't loaded or
 * has no title yet. Selects the string alone, so a caller re-renders only when
 * that title changes, not on every session-list update.
 */
export function useChatTitle(chatId: string): string | undefined {
  return useAuiState((s) => {
    const title = findByChatId(s.threads.threadItems, chatId)?.title?.trim();
    return title || undefined;
  });
}
