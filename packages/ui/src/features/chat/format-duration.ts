/**
 * Duration readouts shared by the chat's two timers: the thread's live running
 * indicator (seconds, ticking) and the per-message timing footer (milliseconds,
 * settled). Both band the same way past a minute so a turn reads the same while
 * it runs and after it lands.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Whole seconds → "9s" / "1m 05s" / "1h 02m". The minute band zero-pads its
 * seconds so a ticking readout keeps a constant width; the hour band drops
 * seconds entirely (they are noise at that scale).
 */
export function formatElapsedSeconds(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${pad(total % 60)}s`;
  return `${Math.floor(total / 3600)}h ${pad(Math.floor(total / 60) % 60)}m`;
}

/**
 * Milliseconds → "412ms" / "8.94s" / "1m 15s" / "2h 15m". Sub-minute turns keep
 * their fractional second (the difference between a 2s and a 9s turn is worth
 * reading); past that the bands take over, so a long run reads "2h 15m" rather
 * than "8158.94s".
 */
export function formatDurationMs(ms: number): string {
  // Round to whole ms before banding, so 999.6ms reads "1.00s" and not "1000ms".
  const total = Math.max(0, Math.round(ms));
  if (total < 1000) return `${total}ms`;
  const seconds = total / 1000;
  return seconds < 60 ? `${seconds.toFixed(2)}s` : formatElapsedSeconds(seconds);
}
