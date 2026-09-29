/**
 * useForkChat — the Fork action's single daemon call + hand-off (todo #343).
 *
 * On success, `switchToThread` opens the new fork even if this beats the
 * `chat.created` broadcast reload: `RemoteThreadListThreadListRuntimeCore`
 * resolves an id absent from the loaded list via `adapter.fetch` (verified
 * against `@assistant-ui/core`'s `_switchToThread`), so there is nothing to
 * poll or await first. `threads.reload()` still runs, best-effort, so the
 * sidebar's own list picks up the new row promptly.
 *
 * The fork also opens in a split (the ⌘-click pair) beside its parent when
 * the parent is on screen, else beside the chat in view (`forkAnchor`) — but
 * only once the fork is in the thread list, since a zone resolves its row by
 * id, so the pair is queued and `useZonesReconciler` opens it.
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
import { forkAnchor } from '@/features/chat/zones/open-in-split';
import { useZonesStore } from '@/features/chat/zones/zones-store';
import { useDaemonPort } from './runtime/daemon-port-context';

export type ForkChatFn = (chatId: string) => Promise<void>;

export function useForkChat(): ForkChatFn {
  const port = useDaemonPort();
  const aui = useAui();

  return useCallback(
    async (chatId: string) => {
      try {
        const chat = await forkChat(port, chatId);
        const zones = useZonesStore.getState();
        const anchor = forkAnchor(chatId, aui.threads.getState().mainThreadId, zones.zones);
        if (anchor != null) zones.queuePair(anchor, chat.id);
        aui.threads.switchToThread(chat.id);
        void aui.threads.reload();
      } catch (err) {
        mfToast.error(err instanceof Error ? err.message : 'Fork failed');
      }
    },
    [port, aui],
  );
}
