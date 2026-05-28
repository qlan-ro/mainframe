import { readdir } from 'node:fs/promises';
import path from 'node:path';

const TASK_ID_RE = /^[a-z0-9]{6,16}$/;

export interface SpoolTaskEntry {
  cwdSeg: string;
  sess: string;
  taskId: string;
  fp: string;
}

export interface WalkOpts {
  /** Walk `${root}/<cwdSeg>/<sess>/tasks/*.output` for every cwdSeg under root. */
  root: string;
  /** When set, only `<cwdSeg> === scopedCwdSeg` is walked (used by worktree sweep). */
  scopedCwdSeg?: string;
  onTask: (task: SpoolTaskEntry) => Promise<void> | void;
}

/**
 * Walk the spool directory and invoke `onTask` for every `<taskId>.output` whose
 * basename matches `TASK_ID_RE`. Does no I/O beyond `readdir` — callers run their
 * own lstat/stat/lsof inside `onTask` so they can early-exit cheaply (e.g.
 * reconcile bails when the chat is unknown).
 */
export async function walkSpoolTasks(opts: WalkOpts): Promise<void> {
  const cwdSegs = opts.scopedCwdSeg ? [opts.scopedCwdSeg] : await safeReaddir(opts.root);
  for (const cwdSeg of cwdSegs) {
    const cwdPath = path.join(opts.root, cwdSeg);
    for (const sess of await safeReaddir(cwdPath)) {
      const tasksDir = path.join(cwdPath, sess, 'tasks');
      for (const f of await safeReaddir(tasksDir)) {
        if (!f.endsWith('.output')) continue;
        const taskId = f.slice(0, -'.output'.length);
        if (!TASK_ID_RE.test(taskId)) continue;
        await opts.onTask({ cwdSeg, sess, taskId, fp: path.join(tasksDir, f) });
      }
    }
  }
}

async function safeReaddir(p: string): Promise<string[]> {
  try {
    return await readdir(p);
  } catch {
    return [];
  }
}
