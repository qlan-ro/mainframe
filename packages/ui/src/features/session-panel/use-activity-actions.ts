/**
 * use-activity-actions — what an Activity row does: its main action, the jump
 * to its transcript row, a background command's output, and Stop.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAui } from '@assistant-ui/react';
import { useZonesStore } from '@/features/chat/zones/zones-store';
import { openInSplit } from '@/features/chat/zones/open-in-split';
import { useSideAwareThreadId } from '@/features/side-chat/side-chat-scope';
import { cancelDelegatedTask, readBackgroundTaskOutput, stopBackgroundTask } from '@/lib/api/background-tasks';
import { mfToast } from '@/lib/toast';
import { isOngoing, type ActivityEntry } from './activity-model';
import { focusPendingRequest, jumpToActivitySource } from './activity-source';
import { usePanelControl, type PanelColumnId } from './panel-control-store';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface ActivityActions {
  onActivate: () => void;
  onJump?: () => void;
  /** Reads a background command's output, which no transcript row shows. */
  readOutput?: () => Promise<string>;
  onStop?: () => void;
  /** A Stop was asked for and the work hasn't ended yet. */
  stopping: boolean;
}

function stopRequest(row: ActivityEntry, chatId: string, adapterId: string | undefined) {
  if (!isOngoing(row.state)) return undefined;
  const { task, delegated } = row;
  // A resumed child is a chat of its own again; its finished task can't be cancelled.
  if (delegated) return delegated.resumedState ? undefined : () => cancelDelegatedTask(chatId, delegated.taskId);
  return task && adapterId === 'claude' ? () => stopBackgroundTask(chatId, task.id) : undefined;
}

/** How long a Stop that went through may take to show before it can be asked for again. */
const STOP_RETRY_MS = 10_000;

/** One Stop at a time: until the work ends, the request fails, or it had time to take effect. */
function useStop(title: string, request: (() => Promise<void>) | undefined) {
  const [stopping, setStopping] = useState(false);
  const pending = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(retry.current), []);
  const release = () => {
    pending.current = false;
    setStopping(false);
  };
  const stop = async () => {
    if (!request || pending.current) return;
    pending.current = true;
    setStopping(true);
    try {
      await request();
      mfToast.success(`Stopped “${title}”`);
      retry.current = setTimeout(release, STOP_RETRY_MS);
    } catch (error) {
      release();
      mfToast.error(`Could not stop “${title}”`, { description: messageOf(error) });
    }
  };
  return { onStop: request && (() => void stop()), stopping: stopping && request !== undefined };
}

function useReadOutput(row: ActivityEntry, chatId: string) {
  const taskId = row.kind === 'command' ? row.task?.id : undefined;
  const read = useCallback(() => readBackgroundTaskOutput(chatId, taskId ?? ''), [chatId, taskId]);
  return taskId === undefined ? undefined : read;
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
  const { onStop, stopping } = useStop(row.title, stopRequest(row, chatId, adapterId));
  const readOutput = useReadOutput(row, chatId);

  /** The floating panel covers what the action is about to show. */
  const reveal = () => setOverlayOpen(columnId, false);

  const outOfHistory = () => mfToast.info(`“${row.title}” started before the history shown here`);

  const jump = () => {
    if (!source) {
      outOfHistory();
      return;
    }
    reveal();
    jumpToActivitySource(chatId, source).then(
      (found) => {
        if (!found) outOfHistory();
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
    readOutput,
    onStop,
    stopping,
  };
}
