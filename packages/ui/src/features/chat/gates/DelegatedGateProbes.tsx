'use client';

/**
 * Surfaces delegated tasks' requests in their parent chat (G5). A task that
 * waits on the user has its session attached (the same hold a split zone
 * takes) for as long as it waits, and its requests join the parent's queue.
 */
import { useEffect } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useChatController } from '@/features/sessions/runtime/use-chat-controller';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { delegatedTasksOf, type DelegatedTaskRow } from '@/features/sessions/view-model/agent-provenance';
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import { useSessionItems } from '../orchestration/use-session-items';
import { useControllerState } from '../runtime/use-chat-thread-runtime';
import { useDelegatedGates } from './delegated-gates-store';

/** The daemon chat a thread item stands for: a canonical item's own id, else the id a local one adopted. */
function daemonChatId(items: readonly SessionItem[], itemId: string): string {
  const item = items.find((candidate) => candidate.id === itemId);
  return item?.remoteId ?? itemId;
}

function DelegatedGateProbe({
  parentChatId,
  row,
  topTaskId,
  parentTitle,
  chatId,
}: WaitingTask & { parentChatId: string }) {
  const port = useDaemonPort();
  const controller = useChatController(chatId, port);
  useEffect(() => controller.holdActive(), [controller]);
  const state = useControllerState(controller);
  const permissions = state.interactions.permissions;
  const mode = state.chatConfig?.permissionMode;
  const { taskId, title, adapterId } = row;

  useEffect(() => {
    const entries = Object.values(permissions).filter((entry) => entry != null);
    if (entries.length === 0) {
      useDelegatedGates.getState().clear(parentChatId, taskId);
      return;
    }
    useDelegatedGates.getState().report({
      parentChatId,
      chatId,
      taskId,
      topTaskId,
      title,
      parentTitle,
      adapterId,
      mode,
      entries,
      reply: (response, selectedOptionId) => controller.replyToPermission(response, selectedOptionId),
    });
  }, [permissions, controller, parentChatId, chatId, taskId, topTaskId, title, parentTitle, adapterId, mode]);
  useEffect(() => () => useDelegatedGates.getState().clear(parentChatId, taskId), [parentChatId, taskId]);
  return null;
}

interface WaitingTask {
  row: DelegatedTaskRow;
  /** The asking task's own ancestor among this chat's tasks, whose row it is in the activity strip. */
  topTaskId: string;
  parentTitle: string | undefined;
  chatId: string;
}

/** The tasks waiting on the user, tasks below them included. */
function waitingTasks(items: SessionItem[], chatId: string, under?: WaitingTask): WaitingTask[] {
  return delegatedTasksOf(items, chatId)
    .filter((row) => row.waiting)
    .flatMap((row) => {
      const child: WaitingTask = {
        row,
        topTaskId: under?.topTaskId ?? row.taskId,
        parentTitle: under?.row.title,
        chatId: daemonChatId(items, row.itemId),
      };
      return [child, ...waitingTasks(items, child.chatId, child)];
    });
}

export function DelegatedGateProbes() {
  const chatId = useAuiState((s) => s.threadListItem?.remoteId ?? null);
  const items = useSessionItems();
  if (chatId == null) return null;
  return waitingTasks(items, chatId).map((task) => (
    <DelegatedGateProbe key={task.row.taskId} parentChatId={chatId} {...task} />
  ));
}
