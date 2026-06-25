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
  const item = useAuiState((s) => s.threadListItem);
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const port = useDaemonPort();

  const chatId = item.id;
  const isActive = mainThreadId === item.id && item.remoteId != null;
  const controller = chatControllerRegistry.getOrCreate(chatId, port);

  return useChatThreadRuntime(controller, port, { active: isActive });
}
