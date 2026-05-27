import treeKill from 'tree-kill';
import type { BackgroundTaskTracker } from './tracker.js';
import { lsofWriters } from './lsof.js';
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
  /** Null when no live CLI for this chat (e.g. recovered orphan). */
  session: SessionLike | null;
  tracker: BackgroundTaskTracker;
}

async function osKillOne(pid: number): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    treeKill(pid, 'SIGKILL', (err?: Error) => {
      if (err) resolve({ ok: false, error: err.message });
      else resolve({ ok: true });
    });
  });
}

export async function killBackgroundTask(args: KillArgs): Promise<KillResult> {
  const task = args.tracker.get(args.chatId, args.taskId);
  if (!task) return { ok: false, error: 'task not found', via: 'none' };

  let stopErr: string | undefined;
  if (args.session) {
    const stop = await args.session.stopBackgroundTask(args.taskId);
    if (stop.ok) return { ok: true, via: 'stop_task' };
    stopErr = stop.error;
    log.warn({ chatId: args.chatId, taskId: args.taskId, err: stop.error }, 'stop_task failed; OS fallback');
  }

  if (!task.outputPath) return { ok: false, error: stopErr ?? 'no outputPath for OS fallback', via: 'none' };
  const writers = await lsofWriters(task.outputPath);
  if (writers.length === 0) return { ok: false, error: stopErr ?? 'no live writer', via: 'none' };

  for (const pid of writers) {
    const r = await osKillOne(pid);
    if (!r.ok) log.warn({ pid, err: r.error }, 'tree-kill failed for one pid');
  }
  const remaining = await lsofWriters(task.outputPath);
  return remaining.length === 0
    ? { ok: true, via: 'tree_kill' }
    : { ok: false, error: `pids still alive: ${remaining.join(',')}`, via: 'tree_kill' };
}
