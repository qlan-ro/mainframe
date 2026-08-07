/**
 * Live elapsed time for the thread's running indicator.
 *
 * Sibling of `useReasoningDuration` (ReasoningGroup.tsx), deliberately NOT a
 * reuse of it: that hook reports a duration only once its window CLOSES, which
 * is the opposite of what a running indicator needs. This one ticks while the
 * run is open and reports nothing once it ends.
 */
import { useEffect, useState } from 'react';

const TICK_MS = 1000;

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
 * Seconds elapsed since `active` last turned true, ticking every second.
 * `undefined` while inactive and for the first second of a run — a turn that
 * resolves in 300 ms must not flash "0s". Each run restarts the count.
 */
export function useRunElapsed(active: boolean): number | undefined {
  const [seconds, setSeconds] = useState<number | undefined>(undefined);

  useEffect(() => {
    setSeconds(undefined);
    if (!active) return;
    const startedAt = Date.now();
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(elapsed >= 1 ? elapsed : undefined);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [active]);

  return seconds;
}
