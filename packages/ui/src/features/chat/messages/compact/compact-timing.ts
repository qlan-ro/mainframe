import type { ToolCallTiming } from '@assistant-ui/react';

const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function compactElapsedMs(timing: ToolCallTiming | undefined, running: boolean, now: number, reported?: number) {
  if (timing && valid(timing.startedAt) && timing.startedAt <= now) {
    if (timing.completedAt !== undefined) {
      if (valid(timing.completedAt) && timing.completedAt >= timing.startedAt && timing.completedAt <= now)
        return timing.completedAt - timing.startedAt;
    } else if (running) return now - timing.startedAt;
  }
  return !running && valid(reported) ? reported : undefined;
}

/**
 * Whether `compactElapsedMs` still moves with the clock: a live call, or a
 * completion the caller's clock has not reached yet.
 */
export function compactElapsedTicks(timing: ToolCallTiming | undefined, running: boolean, now: number): boolean {
  if (!timing || !valid(timing.startedAt)) return false;
  if (timing.completedAt === undefined) return running;
  return valid(timing.completedAt) && timing.completedAt > now;
}

export function formatCompactElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
