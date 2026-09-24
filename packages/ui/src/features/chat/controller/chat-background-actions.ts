/**
 * Stop/dismiss actions for a background-activity row — host-style, mirroring
 * `chat-actions.ts`. Split into its own module so the two files stay under
 * 300 lines and the controller's delegating methods stay one-liners.
 */
import { killBackgroundTask } from '../../../lib/api/background-tasks';
import type { ChatActionHost } from './chat-actions';

/**
 * How long a successful kill call is given to actually settle the row into a
 * terminal state (via the daemon's `background_task.ended` broadcast) before
 * the UI gives up and reports a timeout — the daemon accepted the request but
 * a dead/unresponsive CLI can leave the task running forever.
 */
const STOP_SETTLE_TIMEOUT_MS = 10_000;

/**
 * Request cancellation of a background task. Feedback is entirely event-driven
 * after this call: a successful kill settles the row via the normal
 * `background_task.ended` broadcast, not an optimistic dispatch here — the row
 * must never look stopped while the task is still actually running.
 */
export async function stopBackgroundTask(host: ChatActionHost, taskId: string): Promise<void> {
  host.dispatch({ type: 'background.stop.requested', taskId });
  const result = await killBackgroundTask(host.getDaemonId(), taskId);

  switch (result.kind) {
    case 'ok':
      // The daemon accepted the request; give the task's own `ended` event a
      // window to arrive before assuming it never will (AC4).
      setTimeout(() => {
        const task = host.getState().backgroundTasks[taskId];
        const stop = host.getState().backgroundStops[taskId];
        if (task?.status === 'running' && stop?.phase === 'stopping') {
          host.dispatch({
            type: 'background.stop.failed',
            taskId,
            message: 'Stop requested, but the task is still running.',
          });
        }
      }, STOP_SETTLE_TIMEOUT_MS);
      return;

    // A recovered/orphaned entry, or one the daemon no longer tracks (AC5).
    case 'not-found':
      host.dispatch({ type: 'background.removed', taskId });
      return;

    case 'error':
      host.dispatch({ type: 'background.stop.failed', taskId, message: `Couldn't stop this task: ${result.message}` });
      return;
  }
}

/** Dismiss a terminal row (a no-op reducer-side for a still-running one). */
export function dismissBackgroundTask(host: ChatActionHost, taskId: string): void {
  host.dispatch({ type: 'background.dismissed', taskId });
}
