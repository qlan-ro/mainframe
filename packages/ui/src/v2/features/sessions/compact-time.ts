/**
 * The session row's timestamp: one elapsed unit, as short as it goes.
 *
 * `now`, then `5m` / `4h` / `3d` / `2w` / `6mo` / `1y` — never a weekday or a
 * date. The row right-aligns this against a truncating title, so a variable-
 * width label ("Yest", "Jul 28") makes the column ragged and steals a different
 * amount of the title on every row. One unit reads the same everywhere.
 *
 * Months are `mo`, not `m` — `m` is already minutes, and a row cannot afford the
 * ambiguity between "5 minutes ago" and "5 months ago".
 *
 * A month is 30 days and a year is 365, the usual approximation for relative
 * time: nobody reads `6mo` as a claim about calendar boundaries.
 *
 * NOT the shared `formatRelativeTime`: that one is worded for the automations
 * surfaces too, where a weekday is the useful answer. This is a v2 row style.
 *
 * `now` is injected so tests can pin the clock.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function formatCompactTime(updatedAt: number, now: number): string {
  const elapsed = Math.max(0, now - updatedAt);

  if (elapsed < MINUTE) return 'now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`;
  if (elapsed < MONTH) return `${Math.floor(elapsed / WEEK)}w`;
  if (elapsed < YEAR) return `${Math.floor(elapsed / MONTH)}mo`;
  return `${Math.floor(elapsed / YEAR)}y`;
}
