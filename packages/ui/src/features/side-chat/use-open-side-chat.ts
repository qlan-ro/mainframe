/**
 * useOpenSideChat — the "Open side chat" action's single daemon call +
 * hand-off (todo #344).
 *
 * Mirrors `useForkChat`'s shape. When the parent isn't the active thread, it
 * activates the parent FIRST so the panel the open reveals is actually on
 * screen; opening (or revealing) the side chat is idempotent daemon-side
 * (AC 8), so this can run again with no harm. The registry is stamped
 * immediately with the response so the identity guards (tab store, zones,
 * aui fetch) recognize the id before the next `chat.updated` reload closes
 * the gap (UI rule 1).
 */
import { useCallback } from 'react';
import { useAui } from '@assistant-ui/react';
import { openSideChat } from '@/lib/api/chats';
import { mfToast } from '@/lib/toast';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { registerSideChat } from './side-chat-ids';
import { useSideChatCollapseStore } from './side-chat-collapse-store';

export type OpenSideChatFn = (parentChatId: string) => Promise<void>;

export function useOpenSideChat(): OpenSideChatFn {
  const port = useDaemonPort();
  const aui = useAui();

  return useCallback(
    async (parentChatId: string) => {
      const { mainThreadId } = aui.threads.getState();
      if (mainThreadId !== parentChatId) aui.threads.switchToThread(parentChatId);
      try {
        const sideChat = await openSideChat(port, parentChatId);
        registerSideChat(sideChat.id, parentChatId);
        useSideChatCollapseStore.getState().expand(parentChatId);
      } catch (err) {
        mfToast.error(err instanceof Error ? err.message : 'Could not open side chat');
      }
    },
    [port, aui],
  );
}
