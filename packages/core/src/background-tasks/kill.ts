import treeKill from 'tree-kill';
import { readdir, realpath as fsRealpath } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { BackgroundTaskTracker } from './tracker.js';
import { lsofWriters } from './lsof.js';
import { createChildLogger } from '../logger.js';
import { encodeCwdSegment } from './encoding.js';

const execFileP = promisify(execFileCb);

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

// --- killTasksForChat orchestrator ---

export interface KillTasksForChatArgs {
  chatId: string;
  /** Optional. When set, Task 9's worktree sweep targets `${spoolRoot}/{encoded(worktreePath)}/...`. */
  worktreePath?: string;
  session: SessionLike | null;
  tracker: BackgroundTaskTracker;
  /** Spool root, e.g. /tmp/claude-501. Injected so tests don't depend on /tmp. */
  spoolRoot: string;
}

export interface KillTasksForChatResult {
  killed: Array<{ taskId: string; via: 'stop_task' | 'signal' }>;
  failed: Array<{ taskId: string; error: string }>;
  swept: Array<{ pid: number; command: string }>;
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

    if (!task.outputPath) {
      result.failed.push({ taskId: task.id, error: 'no outputPath' });
      continue;
    }
    const writers = await lsofWriters(task.outputPath);
    if (writers.length === 0) {
      result.failed.push({ taskId: task.id, error: 'no live writer' });
      continue;
    }
    for (const pid of writers) {
      const r = await sigtermThenKill(pid);
      if (!r.ok) log.error({ pid, taskId: task.id, err: r.error }, 'OS kill failed for one pid');
    }
    const remaining = await lsofWriters(task.outputPath);
    if (remaining.length === 0) {
      args.tracker.end(args.chatId, task.id, {
        status: 'stopped',
        outputPath: task.outputPath,
        summary: 'killed via signal',
        usage: null,
      });
      result.killed.push({ taskId: task.id, via: 'signal' });
    } else {
      result.failed.push({ taskId: task.id, error: `pids still alive: ${remaining.join(',')}` });
    }
  }

  if (args.worktreePath) {
    try {
      const realWt = await fsRealpath(args.worktreePath);
      const prefix = path.join(args.spoolRoot, encodeCwdSegment(realWt));
      let sessionDirs: string[] = [];
      try {
        sessionDirs = await readdir(prefix);
      } catch {
        sessionDirs = [];
      }
      for (const sess of sessionDirs) {
        let files: string[] = [];
        try {
          files = await readdir(path.join(prefix, sess, 'tasks'));
        } catch {
          continue;
        }
        for (const f of files) {
          if (!f.endsWith('.output')) continue;
          const fp = path.join(prefix, sess, 'tasks', f);
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
        }
      }
    } catch (err) {
      log.warn({ err, worktreePath: args.worktreePath }, 'worktree sweep aborted');
    }
  }

  return result;
}
