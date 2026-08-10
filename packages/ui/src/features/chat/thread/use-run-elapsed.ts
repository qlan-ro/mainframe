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
