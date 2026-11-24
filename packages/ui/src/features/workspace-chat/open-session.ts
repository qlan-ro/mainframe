/**
 * "Show this session beside the conversation", from wherever a session is
 * listed: ⌘-click or the menu on a session tab or a sidebar row, a tab dragged
 * onto the chat, or ⌘⇧\. It opens as a workspace tab (W9).
 *
 * Ids here are thread-list item ids, as the strip and the sidebar hold them.
 */
import type { AssistantClient } from '@assistant-ui/react';
import { findByChatId } from '@/features/chat/orchestration/use-session-items';
import { isRegisteredSideChatId } from '@/features/side-chat/side-chat-ids';
import type { SessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import type { ChatTabRole } from '@/store/run-pane';
import { openChatTab } from './conversation-tabs';

type Threads = Pick<AssistantClient['threads'], 'getState' | 'item'>;

/** A local draft has no chat to show. */
function isDraftId(id: string): boolean {
  return id.startsWith('__LOCALID_');
}

/**
 * Whether the gesture has anywhere to go: the same question `openSessionBeside`
 * answers by returning false, asked WITHOUT performing it. A menu offering the
 * action reads its disabled state from here, so the two can never disagree.
 */
export function canOpenBeside(activeId: string | null | undefined, id: string): boolean {
  if (activeId == null || id === activeId) return false;
  return !isDraftId(id) && !isDraftId(activeId) && !isRegisteredSideChatId(id);
}

export function roleOf(custom: SessionCustom | undefined): ChatTabRole {
  if (custom?.delegation != null) return 'task';
  return custom?.parentChatId != null ? 'fork' : 'session';
}

/** False when there is nothing to open beside: the caller then just switches to the session. */
export function openSessionBeside(threads: Threads, id: string): boolean {
  const { mainThreadId, threadItems } = threads.getState();
  if (!canOpenBeside(mainThreadId, id)) return false;
  const item = findByChatId(threadItems, id);
  return openChatTab({
    chatId: item?.remoteId ?? id,
    role: roleOf(item?.custom as SessionCustom | undefined),
    title: item?.title ?? 'Untitled',
  });
}

/**
 * A delegated task's own chat, in the workspace beside its parent. An archived
 * one is restored first. With nothing to stand beside, it opens in the column.
 */
export function openTaskTab(threads: AssistantClient['threads'], itemId: string): void {
  const item = findByChatId(threads.getState().threadItems, itemId);
  if (item?.status === 'archived') void threads.item({ id: item.id }).unarchive();
  if (!openSessionBeside(threads, itemId)) threads.switchToThread(itemId);
}
