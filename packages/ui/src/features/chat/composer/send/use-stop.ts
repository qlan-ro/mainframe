'use client';

/**
 * The composer's Stop (C8): it ends everything running in the session — the
 * turn and every sub-agent, sub-agents waiting on a gate included — with no
 * confirmation.
 *
 * Counted as sub-agents: background agents and workflows on an adapter whose
 * tasks can be stopped one by one, and delegated tasks. Background commands
 * and monitors are left alone; each has its own Stop in the activity strip.
 */
import { useAuiState } from '@assistant-ui/react';
import { cancelDelegatedTask, stopBackgroundTask } from '@/lib/api/background-tasks';
import { mfToast } from '@/lib/toast';
import { delegatedTasksOf, type DelegatedTaskRow } from '@/features/sessions/view-model/agent-provenance';
import { useSessionItems } from '../../orchestration/use-session-items';
import { useChatExtras } from '../../runtime/chat-extras';
import { focusVisibleComposer } from '../focus-composer';

/** The adapter whose CLI can stop a single background task. */
export const TASK_STOP_ADAPTER = 'claude';

export interface ComposerStop {
  /** Something is running that Stop would end. */
  available: boolean;
  stopping: boolean;
  /** "the turn and 3 sub-agents". */
  target: string;
  stop: () => void;
}

const FINISHED: readonly DelegatedTaskRow['status'][] = ['completed', 'failed', 'cancelled', 'interrupted'];

/** Still going, or waiting on the user. A resumed child is a chat of its own again. */
export function isOpenTask(row: DelegatedTaskRow): boolean {
  return row.resumedState == null && !FINISHED.includes(row.status);
}

const plural = (n: number) => `${n} sub-agent${n === 1 ? '' : 's'}`;

function stopTarget(running: boolean, agents: number): string {
  if (!running) return plural(agents);
  return agents > 0 ? `the turn and ${plural(agents)}` : 'the turn';
}

export function useComposerStop(): ComposerStop {
  const extras = useChatExtras();
  const running = useAuiState((s) => s.thread.isRunning);
  const items = useSessionItems();
  const chatId = extras?.state.chatId ?? null;
  const stopsTasks = extras?.state.chatConfig?.adapterId === TASK_STOP_ADAPTER;
  const agentTasks = stopsTasks
    ? Object.values(extras?.state.backgroundTasks ?? {}).filter((t) => t.kind === 'agent' || t.kind === 'workflow')
    : [];
  const delegated = chatId ? delegatedTasksOf(items, chatId).filter(isOpenTask) : [];
  const agents = agentTasks.length + delegated.length;
  const stopping = extras?.state.runState.type === 'cancelling';

  const stop = () => {
    if (!extras || chatId == null || stopping || (!running && agents === 0)) return;
    const work: Promise<unknown>[] = [
      ...agentTasks.map((task) => stopBackgroundTask(chatId, task.id)),
      ...delegated.map((row) => cancelDelegatedTask(chatId, row.taskId)),
    ];
    if (running) work.push(extras.cancel());
    void Promise.allSettled(work).then((results) => {
      const failed = results.find((r) => r.status === 'rejected');
      if (!failed) {
        if (agents > 0) mfToast.success(running ? `Stopped · ${plural(agents)} stopped` : `Stopped ${plural(agents)}`);
        return;
      }
      const { reason } = failed as PromiseRejectedResult;
      console.warn('[composer] stop failed', { reason });
      mfToast.error('Could not stop everything', {
        description: reason instanceof Error ? reason.message : String(reason),
      });
    });
    focusVisibleComposer();
  };

  return { available: running || agents > 0, stopping, target: stopTarget(running, agents), stop };
}
