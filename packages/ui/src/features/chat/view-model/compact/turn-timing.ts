import type { SourceUnit, TurnTiming } from './turn-types';

export function verifiedTurnTiming(units: readonly SourceUnit[], now: number): TurnTiming | undefined {
  const timing: TurnTiming = {};
  for (const unit of units) {
    const supplied = unit.presentation?.timing;
    for (const key of ['startedAtMs', 'completedAtMs', 'durationMs'] as const) {
      const value = supplied?.[key];
      if (value === undefined) continue;
      if (!Number.isSafeInteger(value) || value < 0 || (key !== 'durationMs' && value > now)) return undefined;
      if (timing[key] !== undefined && timing[key] !== value) return undefined;
      timing[key] = value;
    }
  }
  const { startedAtMs: start, completedAtMs: end, durationMs } = timing;
  if (
    start !== undefined &&
    end !== undefined &&
    (end < start || (durationMs !== undefined && durationMs !== end - start))
  )
    return undefined;
  return Object.keys(timing).length ? timing : undefined;
}
export function turnDuration(timing: TurnTiming | undefined, running: boolean, now: number): number | undefined {
  if (!timing) return undefined;
  if (timing.durationMs !== undefined) return timing.durationMs;
  if (timing.startedAtMs === undefined || timing.startedAtMs > now) return undefined;
  if (timing.completedAtMs !== undefined) return timing.completedAtMs - timing.startedAtMs;
  return running ? now - timing.startedAtMs : undefined;
}
