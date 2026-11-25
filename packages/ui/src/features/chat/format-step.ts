/** A step's duration: "0.4s", "6.8s", "38s", "1m 04s". */
import { formatElapsedSeconds } from './format-duration';

export function formatStepDuration(ms: number): string {
  if (ms < 10_000) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  return formatElapsedSeconds(Math.round(ms / 1000));
}

/** A turn's duration, to the second: "1s", "18s", "2m 14s". */
export function formatTurnDuration(ms: number): string {
  return formatElapsedSeconds(Math.max(1, Math.round(ms / 1000)));
}
