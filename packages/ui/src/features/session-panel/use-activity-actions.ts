/**
 * use-activity-actions — what an Activity row does: its main action, the jump
 * to its transcript row, and Stop.
 */
import { useAui } from '@assistant-ui/react';
import { useZonesStore } from '@/features/chat/zones/zones-store';
import { openInSplit } from '@/features/chat/zones/open-in-split';
import { useSideAwareThreadId } from '@/features/side-chat/side-chat-scope';
import { cancelDelegatedTask, stopBackgroundTask } from '@/lib/api/background-tasks';
import { mfToast } from '@/lib/toast';
import { isOngoing, type ActivityEntry } from './activity-model';
import { focusPendingRequest, jumpToActivitySource } from './activity-source';
import { usePanelControl, type PanelColumnId } from './panel-control-store';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface ActivityActions {
  onActivate: () => void;
  onJump?: () => void;
  onStop?: () => void;
}

function stopRequest(row: ActivityEntry, chatId: string, adapterId: string | undefined) {
  if (!isOngoing(row.state)) return undefined;
  const { task, delegated } = row;
  // A resumed child is a chat of its own again; its finished task can't be cancelled.
  if (delegated) return delegated.resumedState ? undefined : () => cancelDelegatedTask(chatId, delegated.taskId);
  return task && adapterId === 'claude' ? () => stopBackgroundTask(chatId, task.id) : undefined;
}

export function useActivityActions(
  row: ActivityEntry,
  { chatId, adapterId, columnId }: { chatId: string; adapterId?: string; columnId: PanelColumnId },
): ActivityActions {
  const aui = useAui();
  const threadId = useSideAwareThreadId();
  const openSubagent = useZonesStore((s) => s.openSubagent);
  const splitFits = useZonesStore((s) => s.splitFits);
  const setOverlayOpen = usePanelControl((s) => s.setOverlayOpen);
  const { source } = row;
  const childId = row.delegated?.itemId;
  const stop = stopRequest(row, chatId, adapterId);

  /** The floating panel covers what the action is about to show. */
  const reveal = () => setOverlayOpen(columnId, false);

  const jump = () => {
    if (!source) return;
    reveal();
    jumpToActivitySource(chatId, source).then(
      (found) => {
        if (!found) mfToast.info(`“${row.title}” started before the history shown here`);
      },
      (error: unknown) => mfToast.error('Could not load the message', { description: messageOf(error) }),
    );
  };

  const activate = () => {
    if (childId && threadId) {
      reveal();
      openInSplit(threadId, childId);
      aui.threads.switchToThread(childId);
      return;
    }
    if (row.state === 'needs-you') {
      reveal();
      if (focusPendingRequest(chatId)) return;
    }
    if (row.kind === 'subagent' && source?.toolCallId && threadId && splitFits) {
      reveal();
      openSubagent({
        parentChatId: chatId,
        parentThreadId: threadId,
        toolCallId: source.toolCallId,
        messageId: source.messageId,
        title: row.title,
      });
      return;
    }
    jump();
  };

  return {
    onActivate: activate,
    onJump: source ? jump : undefined,
    onStop: stop
      ? () => {
          stop().then(
            () => mfToast.success(`Stopped “${row.title}”`),
            (error: unknown) => mfToast.error(`Could not stop “${row.title}”`, { description: messageOf(error) }),
          );
        }
      : undefined,
  };
}
