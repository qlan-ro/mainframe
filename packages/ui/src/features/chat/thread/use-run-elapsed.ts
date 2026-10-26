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
 * Seconds elapsed since the run started, ticking every second. The start is the
 * daemon's `startedAtMs` when known, else the moment `active` last turned true.
 * `undefined` while inactive and for the first second of a run — a turn that
 * resolves in 300 ms must not flash "0s".
 */
export function useRunElapsed(active: boolean, startedAtMs?: number): number | undefined {
  const [seconds, setSeconds] = useState<number | undefined>(undefined);

  useEffect(() => {
    setSeconds(undefined);
    if (!active) return;
    const startedAt = startedAtMs !== undefined && startedAtMs <= Date.now() ? startedAtMs : Date.now();
    const tick = () => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(elapsed >= 1 ? elapsed : undefined);
    };
    // A known start can already be minutes old (a reopened chat): show it now, not a tick later.
    if (startedAtMs !== undefined) tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [active, startedAtMs]);

  return seconds;
}
