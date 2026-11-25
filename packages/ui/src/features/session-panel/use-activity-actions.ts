/**
 * use-activity-actions — what an Activity row does: its main action, the jump
 * to its transcript row, a background command's output, and Stop.
 */
import { useCallback } from 'react';
import { useAui } from '@assistant-ui/react';
import { openSubagentTab } from '@/features/workspace-chat/conversation-tabs';
import { openTaskTab } from '@/features/workspace-chat/open-session';
import {
  cancelDelegatedTask,
  readBackgroundTaskOutput,
  stopBackgroundTask,
  type BackgroundTaskOutput,
} from '@/lib/api/background-tasks';
import { isOngoing, type ActivityEntry } from './activity-model';
import { focusPendingRequest } from './activity-source';
import { usePanelControl, type PanelColumnId } from './panel-control-store';
import type { ActivityJumps } from './use-activity-jump';
import { useStop } from './use-stop';

export interface ActivityActions {
  onActivate: () => void;
  onJump?: () => void;
  /** Reads a background command's output, which no transcript row shows. */
  readOutput?: () => Promise<BackgroundTaskOutput>;
  onStop?: () => void;
  /** A Stop was asked for and the work hasn't ended yet. */
  stopping: boolean;
}

/** Undefined when this work can't be stopped on its own. */
export function stopRequest(row: ActivityEntry, chatId: string, adapterId: string | undefined) {
  if (!isOngoing(row.state)) return undefined;
  const { task, delegated } = row;
  // A resumed child is a chat of its own again; its finished task can't be cancelled.
  if (delegated) return delegated.resumedState ? undefined : () => cancelDelegatedTask(chatId, delegated.taskId);
  return task && adapterId === 'claude' ? () => stopBackgroundTask(chatId, task.id) : undefined;
}

function useReadOutput(row: ActivityEntry, chatId: string) {
  const taskId = row.kind === 'command' ? row.task?.id : undefined;
  const read = useCallback(() => readBackgroundTaskOutput(chatId, taskId ?? ''), [chatId, taskId]);
  return taskId === undefined ? undefined : read;
}

export function useActivityActions(
  row: ActivityEntry,
  {
    chatId,
    adapterId,
    columnId,
    jumps,
  }: { chatId: string; adapterId?: string; columnId: PanelColumnId; jumps: ActivityJumps },
): ActivityActions {
  const aui = useAui();
  const setOverlayOpen = usePanelControl((s) => s.setOverlayOpen);
  const { source } = row;
  const childId = row.delegated?.itemId;
  const { onStop, stopping } = useStop(row.title, stopRequest(row, chatId, adapterId));
  const readOutput = useReadOutput(row, chatId);

  /** The floating panel covers what the action is about to show, and takes the focused row with it. */
  const reveal = () => setOverlayOpen(columnId, false);

  const jump = () => jumps.jump(row);

  const activate = () => {
    // A jump still on its way would move the transcript under what this opens.
    jumps.cancel();
    if (childId) {
      reveal();
      openTaskTab(aui.threads, childId, { focus: true });
      return;
    }
    if (row.state === 'needs-you') {
      reveal();
      if (focusPendingRequest(chatId)) return;
    }
    if (row.kind === 'subagent' && source?.toolCallId) {
      reveal();
      const { toolCallId, messageId } = source;
      openSubagentTab({ chatId, toolCallId, messageId, title: row.title }, { focus: true });
      return;
    }
    jump();
  };

  return {
    onActivate: activate,
    onJump: source ? jump : undefined,
    readOutput,
    onStop,
    stopping,
  };
}
