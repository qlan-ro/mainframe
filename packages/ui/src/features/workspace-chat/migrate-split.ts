/**
 * The upgrade from split chats (W9). A persisted pair was two sessions side by
 * side in the chat column, shown whenever either of them was the active one. It
 * becomes a workspace tab each way: each session's workspace gets the other as a
 * chat tab, lit and in front, so opening either still shows both.
 *
 * Runs while the session tabs restore, on the pair's current thread items. Both
 * must still exist; otherwise there is nothing to put side by side. Safe to run
 * twice: a chat is open once per workspace.
 */
import { findByChatId } from '@/features/chat/orchestration/use-session-items';
import { useLayoutStore } from '@/store/layout';
import type { SessionCustom, ThreadListEntry } from '@/features/sessions/view-model/chat-to-thread-custom';
import { chatTab } from './conversation-tabs';
import { roleOf } from './open-session';

export function migrateSplitPair(pair: readonly [string, string], items: readonly ThreadListEntry[]): void {
  const chats = pair.map((id) => {
    const item = findByChatId(items, id);
    const role = roleOf(item?.custom as SessionCustom | undefined);
    return { chatId: item?.remoteId ?? id, title: item?.title ?? 'Untitled', role };
  });
  const [left, right] = chats;
  if (left == null || right == null || left.chatId === right.chatId) return;
  const { addSessionTab } = useLayoutStore.getState();
  addSessionTab(left.chatId, chatTab(right));
  addSessionTab(right.chatId, chatTab(left));
}
