/**
 * useOpenSideChat — the "Open side chat" action's single daemon call + hand-off
 * (todo #344). The side chat opens as a workspace tab (W9).
 *
 * When the parent isn't the active thread, it activates the parent FIRST so the
 * workspace the tab opens in is the one on screen; opening (or revealing) the
 * side chat is idempotent daemon-side (AC 8), so this can run again with no
 * harm. The registry is stamped immediately with the response so the identity
 * guards (tab store, aui fetch) recognize the id before the next `chat.updated`
 * reload closes the gap (UI rule 1).
 */
import { useCallback } from 'react';
import { useAui } from '@assistant-ui/react';
import { openSideChat } from '@/lib/api/chats';
import { mfToast } from '@/lib/toast';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useLayoutStore } from '@/store/layout';
import { registerSideChat } from './side-chat-ids';
import { claimFirstOpen } from './side-chat-tab-store';
import { openSideChatTab } from './use-side-chat-tab';

/** `activateParent` false opens it in the session on screen, whoever the parent is. */
export type OpenSideChatFn = (parentChatId: string, activateParent?: boolean) => Promise<void>;

export function useOpenSideChat(): OpenSideChatFn {
  const port = useDaemonPort();
  const aui = useAui();

  return useCallback(
    async (parentChatId: string, activateParent = true) => {
      const { mainThreadId } = aui.threads.getState();
      if (activateParent && mainThreadId !== parentChatId) aui.threads.switchToThread(parentChatId);
      try {
        const sideChat = await openSideChat(port, parentChatId);
        registerSideChat(sideChat.id, parentChatId);
        const sessionId = activateParent ? parentChatId : useLayoutStore.getState().activeSessionId;
        // Opened by hand: never opened for the user again.
        if (sessionId != null) claimFirstOpen(sessionId, sideChat.id, parentChatId);
        openSideChatTab(sideChat.id, sessionId);
      } catch (err) {
        mfToast.error(err instanceof Error ? err.message : 'Could not open side chat');
      }
    },
    [port, aui],
  );
}
