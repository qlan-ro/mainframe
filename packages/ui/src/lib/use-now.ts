/**
 * A render-safe wall clock for time-relative labels ("5m", "in 2m", elapsed).
 *
 * Never read `Date.now()` during render: the React Compiler caches it with the
 * values computed beside it, so the label freezes until some other input
 * changes. Read this hook instead — the reading is state, refreshed every
 * `intervalMs` while `active`, so the label moves on its own.
 */
import { useEffect, useState } from 'react';

/** Minute-granular labels only need a refresh twice a minute. */
export const NOW_TICK_MS = 30_000;

export function useNow(active = true, intervalMs = NOW_TICK_MS): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}
