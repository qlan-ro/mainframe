/**
 * Task chats — the child chats an agent delegates through the orchestration
 * MCP server (`Chat.delegation`) — live inside their parent's transcript, in
 * the `delegate_task` card, not in any session list. The sidebar, the
 * archived dialog, search, the `@`-session picker and the boot auto-open all
 * read through here.
 *
 * One exception keeps nothing orphaned: a task chat whose parent is gone
 * from the loaded set (deleted or discarded — the list carries archived
 * chats too) stays listed, since it has no card left to open it from.
 *
 * Pure: no daemon calls, no React.
 */
import {
  regularThreadItemsToSessionItems,
  threadItemsToSessionItems,
  type SessionCustom,
  type SessionItem,
  type ThreadListEntry,
} from './chat-to-thread-custom';

/** Every id a loaded chat answers to: the thread id and its daemon id. */
export function loadedChatIds(items: readonly SessionItem[]): Set<string> {
  const ids = new Set<string>();
  for (const it of items) {
    ids.add(it.id);
    if (it.remoteId != null) ids.add(it.remoteId);
  }
  return ids;
}

/** True for a task chat whose parent is loaded — it has a card to live in, so no list row. */
export function isNestedTaskChat(
  custom: Pick<SessionCustom, 'delegation' | 'parentChatId'>,
  loadedIds: ReadonlySet<string>,
): boolean {
  const parent = custom.parentChatId;
  return custom.delegation != null && parent != null && loadedIds.has(parent);
}

/** `items` minus nested task chats; `loaded` is the full loaded set the parents are looked up in. */
export function withoutTaskChats(items: readonly SessionItem[], loaded: readonly SessionItem[] = items): SessionItem[] {
  const loadedIds = loadedChatIds(loaded);
  return items.filter((it) => !isNestedTaskChat(it.custom, loadedIds));
}

/**
 * The regular sessions a list shows: archived chats and nested task chats
 * dropped. The parent lookup spans archived chats, so a task of an archived
 * parent stays inside that parent's card.
 */
export function listedThreadItemsToSessionItems(entries: readonly ThreadListEntry[]): SessionItem[] {
  return withoutTaskChats(regularThreadItemsToSessionItems(entries), threadItemsToSessionItems(entries));
}
