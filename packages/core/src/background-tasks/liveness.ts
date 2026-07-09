import type { BackgroundTaskTracker } from './tracker.js';
import { lsofWritersDetailed } from './lsof.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('background-tasks:liveness');

export const TICK_MS = 60_000;
export const GRACE_MS = 90_000;
export const WAKE_DELTA_MULT = 2;

export type MissMap = Map<string, Map<string, number>>;

export interface LivenessDeps {
  tracker: BackgroundTaskTracker;
  intervalMs?: number;
}

export interface LivenessSchedulerHandle {
  stop(): void;
}

export interface SweepArgs {
  tracker: BackgroundTaskTracker;
  missMap: MissMap;
  now: number;
  forceWake: boolean;
}

/** Read the current miss count for `(chatId, taskId)`. Exported for tests. */
export function getMissCount(missMap: MissMap, chatId: string, taskId: string): number {
  return missMap.get(chatId)?.get(taskId) ?? 0;
}

function setMiss(missMap: MissMap, chatId: string, taskId: string, count: number): void {
  const inner = missMap.get(chatId) ?? new Map<string, number>();
  inner.set(taskId, count);
  missMap.set(chatId, inner);
}

function deleteMiss(missMap: MissMap, chatId: string, taskId: string): void {
  const inner = missMap.get(chatId);
  if (!inner) return;
  inner.delete(taskId);
  if (inner.size === 0) missMap.delete(chatId);
}

/** One-shot sweep. Exported for direct testing. */
export async function runLivenessSweep(args: SweepArgs): Promise<void> {
  const { tracker, missMap, now, forceWake } = args;
  const liveByChat = new Map<string, Set<string>>();
  for (const { chatId, task } of tracker.listAllRunning()) {
    let set = liveByChat.get(chatId);
    if (!set) {
      set = new Set();
      liveByChat.set(chatId, set);
    }
    set.add(task.id);

    // lsof-writer liveness only holds for bash tasks (the shell keeps the
    // spool file open). Agents/workflows run inside the CLI and have no
    // writer — probing them would false-stop live work. They close via
    // task_notification bookends or endAllRunning on CLI exit.
    if (task.kind !== 'bash') continue;
    if (now - task.startedAt < GRACE_MS) continue;
    if (!task.outputPath) {
      log.warn({ chatId, taskId: task.id }, 'liveness skip: no outputPath');
      continue;
    }
    const r = await lsofWritersDetailed(task.outputPath);
    if (!r.ok) {
      // Skip: don't mass-mark stopped on lsof failure.
      continue;
    }
    if (r.pids.length > 0) {
      deleteMiss(missMap, chatId, task.id);
      tracker.setPid(chatId, task.id, r.pids[0]!);
      continue;
    }
    // Empty observation
    const prev = getMissCount(missMap, chatId, task.id);
    if (forceWake || prev >= 1) {
      deleteMiss(missMap, chatId, task.id);
      tracker.end(chatId, task.id, {
        status: 'stopped',
        outputPath: task.outputPath,
        summary: 'process gone (liveness sweep)',
        usage: null,
      });
    } else {
      setMiss(missMap, chatId, task.id, prev + 1);
    }
  }
  // GC chats no longer tracked; tasks no longer running.
  for (const chatId of [...missMap.keys()]) {
    const live = liveByChat.get(chatId);
    if (!live) {
      missMap.delete(chatId);
      continue;
    }
    const inner = missMap.get(chatId)!;
    for (const taskId of [...inner.keys()]) if (!live.has(taskId)) inner.delete(taskId);
    if (inner.size === 0) missMap.delete(chatId);
  }
}

export function startLivenessScheduler(deps: LivenessDeps): LivenessSchedulerHandle {
  const intervalMs = deps.intervalMs ?? TICK_MS;
  const missMap: MissMap = new Map();
  let lastTick = Date.now();
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const now = Date.now();
    const delta = now - lastTick;
    const forceWake = delta > intervalMs * WAKE_DELTA_MULT;
    if (forceWake) log.info({ delta }, 'liveness: wake detected (wallclock jump)');
    lastTick = now;
    try {
      await runLivenessSweep({ tracker: deps.tracker, missMap, now, forceWake });
    } catch (err) {
      log.warn({ err }, 'liveness sweep failed');
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, intervalMs);
  handle.unref?.();
  return {
    stop(): void {
      stopped = true;
      clearInterval(handle);
    },
  };
}
