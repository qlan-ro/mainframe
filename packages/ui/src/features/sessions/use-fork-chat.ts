/**
 * useForkChat — the Fork action's single daemon call + hand-off (todo #343),
 * also used by "Fork from here" on an assistant turn.
 *
 * On success the fork opens as a workspace tab beside the conversation on
 * screen, which stays where it is (W9). It is a session like any other, so the
 * sidebar lists it and its tab can move it into the chat column. With no
 * conversation to stand beside (a draft), it opens in the column instead.
 *
 * `threads.reload()` runs at once so the list picks the fork up promptly; until
 * it does, the tab says it is opening.
 *
 * On failure the daemon's own message is shown verbatim (spec: "an error
 * toast shows the daemon's failure message") and nothing else happens.
 *
 * Returns a Promise so callers (and tests) can await settlement; menu
 * `onSelect` handlers ignore it under TypeScript's void-return compatibility.
 */
import { useCallback } from 'react';
import { useAui } from '@assistant-ui/react';
import { forkChat } from '@/lib/api/chats';
import { mfToast } from '@/lib/toast';
import { openChatTab } from '@/features/workspace-chat/conversation-tabs';
import { useDaemonPort } from './runtime/daemon-port-context';

/** Fork immediately before one sent user message. */
export interface ForkFromMessage {
  fromMessageId: string;
}

export type ForkChatFn = (chatId: string, from?: ForkFromMessage) => Promise<void>;

export function useForkChat(): ForkChatFn {
  const port = useDaemonPort();
  const aui = useAui();

  return useCallback(
    async (chatId: string, from?: ForkFromMessage) => {
      try {
        const chat = await (from == null
          ? forkChat(port, chatId)
          : forkChat(port, chatId, { fromMessageId: from.fromMessageId }));
        const { mainThreadId } = aui.threads.getState();
        const beside = mainThreadId != null && !mainThreadId.startsWith('__LOCALID_');
        if (beside) openChatTab({ chatId: chat.id, role: 'fork', title: chat.title ?? 'Fork' });
        else aui.threads.switchToThread(chat.id);
        void aui.threads.reload();
      } catch (err) {
        mfToast.error(err instanceof Error ? err.message : 'Fork failed');
      }
    },
    [port, aui],
  );
}
