/**
 * Elapsed-time readings for the panel's Background Activity section. Kept apart
 * from `activity-view.ts`, which is deliberately React-free — `useNow` is a hook.
 */
import { formatRunDuration } from '@/features/chat/workflow/workflow-progress';

/** Re-renders every 30s so elapsed times stay fresh while work is live. */
export { useNow } from '@/lib/use-now';

/** "<1m", "5m", "1h 12m" — minute-level is enough for a background row. */
export function formatElapsed(startedAt: number, now: number): string {
  return formatRunDuration(now - startedAt);
}
