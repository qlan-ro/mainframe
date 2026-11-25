/**
 * navigateToSession — routes a session-navigation request (AppShell's session
 * navigator, the global toast deep link) to its real target (todo #344, UI
 * rule 2).
 *
 * A side chat is never in the thread list, so switching to its id directly
 * would leave aui's `fetch` guard (`chats-remote-adapter.ts`) rejecting it —
 * the request must resolve to the PARENT instead, with the side chat's tab in
 * front of the parent's workspace.
 * The registry answers most calls synchronously; `getChat` is the fallback for
 * an id the registry hasn't seen yet (a toast that outlives a reload).
 */
import type { Chat } from '@qlan-ro/mainframe-types';
import { isRegisteredSideChatId, isSideChat, parentOfSideChat, registerSideChat } from './side-chat-ids';
import { openSideChatTab } from './use-side-chat-tab';

export interface NavigateToSessionDeps {
  switchToThread: (id: string) => void;
  /** Only called when the registry doesn't already recognize `id`. */
  getChat: (id: string) => Promise<Chat>;
}

function showSideChat(sideChatId: string, parentChatId: string, deps: NavigateToSessionDeps): void {
  deps.switchToThread(parentChatId);
  openSideChatTab(sideChatId, parentChatId);
}

export async function navigateToSession(id: string, deps: NavigateToSessionDeps): Promise<void> {
  if (isRegisteredSideChatId(id)) {
    const parentId = parentOfSideChat(id);
    if (parentId != null) {
      showSideChat(id, parentId, deps);
      return;
    }
  }

  try {
    const chat = await deps.getChat(id);
    if (isSideChat(chat) && chat.parentChatId != null) {
      registerSideChat(chat.id, chat.parentChatId);
      showSideChat(chat.id, chat.parentChatId, deps);
      return;
    }
  } catch {
    // expected: an unknown id or an unreachable daemon — fall through to a
    // plain switch so the deep link degrades to today's behavior instead of
    // silently doing nothing.
  }
  deps.switchToThread(id);
}
