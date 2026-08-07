/**
 * Elapsed-time readings for the panel's Background Activity section. Kept apart
 * from `activity-view.ts`, which is deliberately React-free — `useNow` is a hook.
 */
import { useEffect, useState } from 'react';
import { formatRunDuration } from '@/features/chat/workflow/workflow-progress';

/** "<1m", "5m", "1h 12m" — minute-level is enough for a background row. */
export function formatElapsed(startedAt: number, now: number): string {
  return formatRunDuration(now - startedAt);
}

/** Re-renders every 30s so elapsed times stay fresh while work is live. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [active]);
  return active ? now : Date.now();
}
