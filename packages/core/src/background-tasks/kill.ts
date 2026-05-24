import treeKill from 'tree-kill';
import type { BackgroundTaskTracker } from './tracker.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('background-tasks:kill');

export type KillResult =
  | { ok: true; via: 'stop_task' | 'tree_kill' }
  | { ok: false; error: string; via: 'stop_task' | 'tree_kill' | 'none' };

export interface SessionLike {
  stopBackgroundTask(taskId: string): Promise<{ ok: boolean; error?: string }>;
}

export interface KillArgs {
  chatId: string;
  taskId: string;
  session: SessionLike;
  tracker: BackgroundTaskTracker;
}

export async function killBackgroundTask(args: KillArgs): Promise<KillResult> {
  const task = args.tracker.get(args.chatId, args.taskId);
  if (!task) return { ok: false, error: 'task not found', via: 'none' };

  const stopResult = await args.session.stopBackgroundTask(args.taskId);
  if (stopResult.ok) {
    return { ok: true, via: 'stop_task' };
  }

  log.warn(
    { chatId: args.chatId, taskId: args.taskId, error: stopResult.error },
    'stop_task failed; attempting OS fallback',
  );

  const pid = (task as { pid?: number }).pid;
  if (typeof pid !== 'number') {
    return { ok: false, error: stopResult.error ?? 'unknown error', via: 'none' };
  }

  return new Promise<KillResult>((resolve) => {
    treeKill(pid, 'SIGKILL', (err?: Error) => {
      if (err) {
        log.warn({ pid, err }, 'tree-kill fallback failed');
        resolve({ ok: false, error: err.message, via: 'tree_kill' });
      } else {
        resolve({ ok: true, via: 'tree_kill' });
      }
    });
  });
}
