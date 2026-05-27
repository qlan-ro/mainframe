import type { BackgroundTaskTracker } from './tracker.js';
import { lsofWritersDetailed } from './lsof.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('background-tasks:liveness');

export const TICK_MS = 60_000;
export const GRACE_MS = 90_000;
export const WAKE_DELTA_MULT = 2;

export interface LivenessDeps {
  tracker: BackgroundTaskTracker;
  intervalMs?: number;
}

export interface LivenessSchedulerHandle {
  stop(): void;
}

export interface SweepArgs {
  tracker: BackgroundTaskTracker;
  missMap: Map<string, number>;
  now: number;
  forceWake: boolean;
}

/** One-shot sweep. Exported for direct testing. */
export async function runLivenessSweep(args: SweepArgs): Promise<void> {
  const { tracker, missMap, now, forceWake } = args;
  const seenKeys = new Set<string>();
  for (const { chatId, task } of tracker.listAllRunning()) {
    const key = `${chatId}/${task.id}`;
    seenKeys.add(key);
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
      missMap.delete(key);
      tracker.setPid(chatId, task.id, r.pids[0]!);
      continue;
    }
    // Empty observation
    const prev = missMap.get(key) ?? 0;
    if (forceWake || prev >= 1) {
      missMap.delete(key);
      tracker.end(chatId, task.id, {
        status: 'stopped',
        outputPath: task.outputPath,
        summary: 'process gone (liveness sweep)',
        usage: null,
      });
    } else {
      missMap.set(key, prev + 1);
    }
  }
  // GC misses for tasks no longer in tracker
  for (const k of [...missMap.keys()]) if (!seenKeys.has(k)) missMap.delete(k);
}

export function startLivenessScheduler(deps: LivenessDeps): LivenessSchedulerHandle {
  const intervalMs = deps.intervalMs ?? TICK_MS;
  const missMap = new Map<string, number>();
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
