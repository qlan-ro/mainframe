/**
 * The keyboard twins of the workspace's chat gestures. Registered by
 * ChatSurface, so they exist exactly while a chat surface is mounted.
 *
 * ⌘⇧\ opens the next session tab beside the conversation: the first one, in the
 * strip's order, that can and is not there yet, so pressing it again opens another. ⌘\ takes the chat tab that is in
 * front off the workspace; the chat stays. Inert while another kind of tab is.
 */
import type { AssistantClient } from '@assistant-ui/react';
import { flushSync } from 'react-dom';
import { focusAfterClosedTab } from '@/features/chat/composer/focus-composer';
import { useSessionTabsStore } from '@/features/session-tabs/store';
import { canonicalTabId, displayedTabIds, nextBesideId } from '@/features/session-tabs/tabs-model';
import { useShortcutAction } from '@/features/shortcuts/action-store';
import { useLayoutStore } from '@/store/layout';
import { isSurfaceLit } from '@/store/layout-placement';
import { isConversationTab } from '@/store/run-pane';
import { findByChatId } from '@/features/chat/orchestration/use-session-items';
import { findChatTab } from './conversation-tabs';
import { openSessionBeside } from './open-session';

function closeFrontConversation(): void {
  const { layout, run, closeRunTab } = useLayoutStore.getState();
  if (!isSurfaceLit(layout, 'workspace')) return;
  for (const pane of run?.panes ?? []) {
    const front = pane.tabs.find((t) => t.id === pane.active);
    if (front == null || !isConversationTab(front)) continue;
    // Closing unmounts what has the focus, which would fall to the body and take the keyboard with it.
    const held = document.activeElement?.closest('[data-conversation-tab="active"]') != null;
    flushSync(() => closeRunTab(pane.id, front.id));
    if (held && (document.activeElement == null || document.activeElement === document.body)) focusAfterClosedTab();
    return;
  }
}

export function useConversationShortcuts(aui: AssistantClient): void {
  useShortcutAction('sessions.close-beside', closeFrontConversation);

  useShortcutAction('sessions.open-beside', () => {
    const { mainThreadId, threadItems } = aui.threads.getState();
    if (mainThreadId == null) return;
    // The strip canonicalizes too: during the draft → canonical handover the raw
    // main id is absent from the displayed set, and an uncanonicalized lookup
    // would find no partner where the menu offers one.
    const activeId = canonicalTabId(mainThreadId, threadItems);
    const { run } = useLayoutStore.getState();
    const opened = (id: string) => findChatTab(run, findByChatId(threadItems, id)?.remoteId ?? id) != null;
    const partner = nextBesideId(displayedTabIds(useSessionTabsStore.getState()), activeId, opened);
    if (partner != null) openSessionBeside(aui.threads, partner);
  });
}
