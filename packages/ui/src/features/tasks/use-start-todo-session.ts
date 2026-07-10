/**
 * useStartTodoSession — navigates to a new session prefilled with the todo's
 * agent-first message, matching desktop ComposerCard.tsx:217 behavior.
 *
 * Daemon contract: `start-session` creates an EMPTY chat and returns `chatId`
 * + `initialMessage` separately. The daemon does NOT seed the message. The
 * client prefills the composer (not auto-sent).
 *
 * Thread-id resolution: the daemon's `chatId` IS the `remoteId` in the thread
 * list (chatToThreadCustom sets `remoteId = chat.id`). After `reload()`, the
 * new thread item appears in the list keyed by its `remoteId`. switchToThread
 * accepts a `remoteId` directly (RemoteThreadListThreadListRuntimeCore
 * lookups via threadIdMap[remoteId] → mappingId), so we pass `chatId`
 * directly — no manual resolution of item.id needed.
 *
 * Confirmed in: SearchPalette.tsx:51 (calls switchToThread with remoteId).
 *
 * Status transition: if the todo is `open`, it is moved to `in_progress`
 * before the session starts (mirrors desktop behavior).
 */
import { useCallback } from 'react';
import { useAssistantRuntime, useAui } from '@assistant-ui/react';
import { startTodoSession, moveTodo, type TodoStatus } from '@/lib/api/todos';
import { useTodosStore } from './use-todos-store';

export function useStartTodoSession(
  port: number,
  projectId: string | undefined,
): (todoId: string, currentStatus?: TodoStatus) => Promise<void> {
  const runtime = useAssistantRuntime();
  const aui = useAui();

  return useCallback(
    async (todoId: string, currentStatus?: TodoStatus): Promise<void> => {
      if (!projectId) return;
      if (currentStatus === 'open') {
        await moveTodo(port, todoId, 'in_progress');
        await useTodosStore.getState().load(port, projectId);
      }
      const { chatId, initialMessage } = await startTodoSession(port, todoId, projectId);
      // Reload the thread list so the new remote chat appears before switching.
      await runtime.threads.reload();
      // chatId IS the remoteId; switchToThread resolves it via threadIdMap.
      // Await it: the switch is async (mainThreadId only catches up when it
      // resolves), so prefilling before it lands would setText on the previously
      // active thread's composer and open the new chat blank (#212).
      await runtime.threads.switchToThread(chatId);
      // Prefill the new chat's composer — NOT auto-sent (parity with desktop).
      aui.composer().setText(initialMessage);
    },
    [port, projectId, runtime, aui],
  );
}
