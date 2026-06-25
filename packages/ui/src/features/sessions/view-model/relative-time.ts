/**
 * Pure relative-time formatter for session row timestamps.
 *
 * Rules (matching the prototype 02-chrome.jsx `s.when` display):
 *   - Same calendar day  → "H:MM AM/PM" (HH:MM in 24h locales) — tabular-nums
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

export function formatRelativeTime(updatedAt: number, now: number): string {
  const todayStart = startOfDay(now);
  const itemStart = startOfDay(updatedAt);
  const daysDiff = Math.round((todayStart - itemStart) / 86_400_000);

  if (daysDiff === 0) {
    return new Date(updatedAt).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  if (daysDiff === 1) return 'Yest';

  if (daysDiff < 7) {
    return new Date(updatedAt).toLocaleDateString(undefined, { weekday: 'short' });
  }

  return new Date(updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
