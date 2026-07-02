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
 */
import { useAuiState } from '@assistant-ui/react';
import type { AssistantRuntime } from '@assistant-ui/react';
import { chatControllerRegistry } from './chat-controller-registry';
import { useDaemonPort } from './daemon-port-context';
import { useChatThreadRuntime } from '../../chat/runtime/use-chat-thread-runtime';

export function useChatRuntimeHook(): AssistantRuntime {
  const chatId = useAuiState((s) => s.threadListItem.id);
  // Subscribe to the DERIVED active boolean, not the raw mainThreadId. aui keeps
  // every visited thread's subtree mounted, so a raw `mainThreadId` subscription
  // re-runs this hook (and re-renders that subtree) in EVERY warm thread on each
  // switch — cost grows with session count. Selecting the boolean means only the
  // two threads whose active-ness actually flips re-render.
  const isActive = useAuiState(
    (s) => s.threads.mainThreadId === s.threadListItem.id && s.threadListItem.remoteId != null,
  );
  const port = useDaemonPort();

  const controller = chatControllerRegistry.getOrCreate(chatId, port);

  return useChatThreadRuntime(controller, port, { active: isActive });
}
