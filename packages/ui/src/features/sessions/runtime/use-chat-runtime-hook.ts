/**
 * The runtimeHook for useRemoteThreadListRuntime (§3.2).
 *
 * assistant-ui mounts one subtree per alive thread and runs this hook inside
 * each thread's `threadListItem` context — there is NO threadId argument, so it
 * resolves its own chatId from context. It returns synchronously (invariant 2):
 * a suspending/throwing hook leaves switchToThread stuck.
 *
 * - chatId = item.id (S1: stable for life — __LOCALID_* for a new thread until
 *   the controller learns its remote id via setRemoteId; the daemon id for a
 *   pre-existing thread). NEVER item.remoteId — there is no id-flip.
 * - active = this thread is mainThreadId AND it has a daemon chat (remoteId set);
 *   only then does the controller open a live WS sub (D4). A brand-new local
 *   thread with no remoteId is never live.
 *
 * `ownsComposer`: this hook's hidden instance is kept warm for every alive
 * thread, whatever the chat surface renders. Its composer is the one on screen
 * only while its chat is the conversation. A chat open in a workspace tab has a
 * composer of its own there (`use-conversation-thread`), and a draft must be in
 * whichever of the two the user sees, so:
 *
 * - this instance takes a stashed draft only while it owns the composer; a tab's
 *   `DraftKeeper` takes it otherwise.
 * - `shownInTab` turning true hands whatever this composer holds to the stash,
 *   for the tab to pick up. Losing the screen to another session does NOT: that
 *   composer still holds the draft, and stashing it there made a later offload
 *   overwrite the real draft with an emptied one (#178).
 */
import { useAuiState } from '@assistant-ui/react';
import type { AssistantRuntime } from '@assistant-ui/react';
import { useChatController } from './use-chat-controller';
import { useDaemonPort } from './daemon-port-context';
import { useChatThreadRuntime } from '../../chat/runtime/use-chat-thread-runtime';
import { useMountedConversations } from '../../workspace-chat/mounted-conversations';

export function useChatRuntimeHook(): AssistantRuntime {
  const chatId = useAuiState((s) => s.threadListItem.id);
  // Subscribe to the DERIVED active boolean, not the raw mainThreadId. aui keeps
  // every visited thread's subtree mounted, so a raw `mainThreadId` subscription
  // re-runs this hook (and re-renders that subtree) in EVERY warm thread on each
  // switch — cost grows with session count. Note aui (0.15.13) still re-renders
  // every warm thread once per switch on its own (a fresh client context), so
  // the booleans keep this hook off the switch path rather than remove it.
  const isMain = useAuiState((s) => s.threads.mainThreadId === s.threadListItem.id);
  const isActive = useAuiState(
    (s) => s.threads.mainThreadId === s.threadListItem.id && s.threadListItem.remoteId != null,
  );
  const port = useDaemonPort();

  const controller = useChatController(chatId, port);

  // A boolean about THIS chat only, for the same reason as `isActive`.
  const shownInTab = useMountedConversations((s) => s.composing.has(chatId));
  const ownsComposer = isMain && !shownInTab;

  return useChatThreadRuntime(controller, port, { active: isActive, chatId, ownsComposer, shownInTab });
}
