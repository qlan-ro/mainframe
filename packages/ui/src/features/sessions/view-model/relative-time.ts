/**
 * Pure relative-time formatter for session row timestamps.
 *
 * Rules:
 *   - Same calendar day  → duration-since ("just now" / "Nm" / "Nh") — compact,
 *     fits a session row (also shared by automation LastRunPill/RunView, which
 *     import this same helper).
 *   - Yesterday          → "Yest"
 *   - Within 7 days      → short weekday (e.g. "Mon")
 *   - Older              → "MMM D" (e.g. "Jun 3")
 *
 * Both `updatedAt` and `now` are injected so unit tests can use fixed dates.
 */

function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "just now" (<60s), "Nm" (1-59min), else "Nh" (bounded by the same-day caller). */
function durationSince(updatedAt: number, now: number): string {
  const elapsedSec = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (elapsedSec < 60) return 'just now';
  const elapsedMin = Math.floor(elapsedSec / 60);
  if (elapsedMin < 60) return `${elapsedMin}m`;
  return `${Math.floor(elapsedMin / 60)}h`;
}

export function formatRelativeTime(updatedAt: number, now: number): string {
  const todayStart = startOfDay(now);
  const itemStart = startOfDay(updatedAt);
  const daysDiff = Math.round((todayStart - itemStart) / 86_400_000);

  if (daysDiff === 0) {
    return durationSince(updatedAt, now);
  }

  if (daysDiff === 1) return 'Yest';

  if (daysDiff < 7) {
    return new Date(updatedAt).toLocaleDateString(undefined, { weekday: 'short' });
  }

  return new Date(updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
