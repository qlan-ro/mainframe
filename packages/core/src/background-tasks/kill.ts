import treeKill from 'tree-kill';
import { realpath as fsRealpath, lstat } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { BackgroundTaskTracker } from './tracker.js';
import { lsofWriters } from './lsof.js';
import { createChildLogger } from '../logger.js';
import { encodeCwdSegment } from './encoding.js';
import { spoolRoot as defaultSpoolRoot } from './spool-root.js';
import { walkSpoolTasks } from './spool-walker.js';

const execFileP = promisify(execFileCb);

const log = createChildLogger('background-tasks:kill');

export type KillResult =
  | { ok: true; via: 'stop_task' | 'signal' }
  | { ok: false; error: string; via: 'stop_task' | 'signal' | 'none' };

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

export const GRACE_MS = 800;

async function sigtermThenKill(pid: number): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    treeKill(pid, 'SIGTERM', (sigErr?: Error) => {
      if (sigErr) log.warn({ pid, err: sigErr }, 'SIGTERM failed; trying SIGKILL');
      setTimeout(() => {
        treeKill(pid, 'SIGKILL', (killErr?: Error) => {
          if (killErr) resolve({ ok: false, error: killErr.message });
          else resolve({ ok: true });
        });
      }, GRACE_MS);
    });
  });
}

async function commandForPid(pid: number): Promise<string> {
  try {
    const { stdout } = await execFileP('ps', ['-p', String(pid), '-o', 'comm='], { timeout: 1000, encoding: 'utf8' });
    return (stdout as string).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * OS-level kill for a single task: identify writers via lsof, signal them, then
 * re-check there are no survivors. Used by both single-task and per-chat paths.
 */
async function killOneTaskOS(
  task: { outputPath: string | null },
  signaller: (pid: number) => Promise<{ ok: boolean; error?: string }>,
): Promise<
  { ok: true; via: 'signal' } | { ok: false; reason: 'no_output_path' | 'no_writer' | 'survivors'; error: string }
> {
  if (!task.outputPath) return { ok: false, reason: 'no_output_path', error: 'no outputPath' };
  const writers = await lsofWriters(task.outputPath);
  if (writers.length === 0) return { ok: false, reason: 'no_writer', error: 'no live writer' };
  for (const pid of writers) {
    const r = await signaller(pid);
    if (!r.ok) log.warn({ pid, err: r.error }, 'signal failed for one pid');
  }
  const remaining = await lsofWriters(task.outputPath);
  if (remaining.length > 0) {
    return { ok: false, reason: 'survivors', error: `pids still alive: ${remaining.join(',')}` };
  }
  return { ok: true, via: 'signal' };
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

  const os = await killOneTaskOS(task, sigtermThenKill);
  if (os.ok) {
    args.tracker.end(args.chatId, args.taskId, {
      status: 'stopped',
      outputPath: task.outputPath ?? '',
      summary: 'killed via signal',
      usage: null,
    });
    return { ok: true, via: 'signal' };
  }
  // Preserve previous behavior for failure-only paths: when there's no live
  // writer or no outputPath and stop_task already failed, callers expect
  // via:'none'. When the OS signal actually ran but survivors remained,
  // surface via:'signal'.
  if (os.reason === 'survivors') {
    return { ok: false, error: stopErr ?? os.error, via: 'signal' };
  }
  return { ok: false, error: stopErr ?? os.error, via: 'none' };
}

// --- killTasksForChat orchestrator ---

export interface KillTasksForChatArgs {
  chatId: string;
  /** Optional. When set, Task 9's worktree sweep targets `${spoolRoot}/{encoded(worktreePath)}/...`. */
  worktreePath?: string;
  session: SessionLike | null;
  tracker: BackgroundTaskTracker;
  /** Test-only override. Production callers omit this and default to spoolRoot(). */
  spoolRoot?: string;
}

export interface KillTasksForChatResult {
  killed: Array<{ taskId: string; via: 'stop_task' | 'signal' }>;
  failed: Array<{ taskId: string; error: string }>;
  swept: Array<{ pid: number; command: string }>;
}

export async function killTasksForChat(args: KillTasksForChatArgs): Promise<KillTasksForChatResult> {
  const result: KillTasksForChatResult = { killed: [], failed: [], swept: [] };
  const running = args.tracker.list(args.chatId).filter((t) => t.status === 'running');

  for (const task of running) {
    if (args.session) {
      const stop = await args.session.stopBackgroundTask(task.id);
      if (stop.ok) {
        args.tracker.end(args.chatId, task.id, {
          status: 'stopped',
          outputPath: task.outputPath ?? '',
          summary: 'killed via stop_task',
          usage: null,
        });
        result.killed.push({ taskId: task.id, via: 'stop_task' });
        continue;
      }
      log.warn({ chatId: args.chatId, taskId: task.id, err: stop.error }, 'stop_task failed; OS fallback');
    }

    const os = await killOneTaskOS(task, sigtermThenKill);
    if (os.ok) {
      args.tracker.end(args.chatId, task.id, {
        status: 'stopped',
        outputPath: task.outputPath ?? '',
        summary: 'killed via signal',
        usage: null,
      });
      result.killed.push({ taskId: task.id, via: 'signal' });
    } else {
      result.failed.push({ taskId: task.id, error: os.error });
    }
  }

  if (args.worktreePath) {
    try {
      const realWt = await fsRealpath(args.worktreePath);
      const scopedCwdSeg = encodeCwdSegment(realWt);
      const root = args.spoolRoot ?? defaultSpoolRoot();
      await walkSpoolTasks({
        root,
        scopedCwdSeg,
        onTask: async ({ fp }) => {
          try {
            const ls = await lstat(fp);
            if (!ls.isFile() || ls.isSymbolicLink()) return;
          } catch {
            return;
          }
          const writers = await lsofWriters(fp);
          for (const pid of writers) {
            if (pid === process.pid) continue;
            const command = await commandForPid(pid);
            const r = await sigtermThenKill(pid);
            if (r.ok) {
              result.swept.push({ pid, command });
              log.info({ pid, command, file: fp }, 'worktree sweep killed pid');
            } else {
              log.error({ pid, command, err: r.error }, 'worktree sweep kill failed');
            }
          }
        },
      });
    } catch (err) {
      log.warn({ err, worktreePath: args.worktreePath }, 'worktree sweep aborted');
    }
  }

  if (result.failed.length > 0) {
    log.warn({ chatId: args.chatId, failed: result.failed }, 'killTasksForChat: some failures');
  }
  if (result.swept.length > 0) {
    log.info({ chatId: args.chatId, swept: result.swept }, 'worktree sweep killed extras');
  }

  return result;
}
