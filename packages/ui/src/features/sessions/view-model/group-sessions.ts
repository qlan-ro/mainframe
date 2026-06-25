/**
 * Sessions sidebar view-model: arrange the filtered session list into the
 * warm-chrome artboard's groups.
 *
 * The artboard does NOT group by project — it groups by TIME, surfaces a
 * Pinned section first, and offers a Sort By menu (Recent / Name / Status).
 * Project narrowing is handled by the filter pills + the per-row project chip,
 * not by grouping. See 02-chrome.jsx `arrangeSessions`/`groupSessionsByTime`/
 * `SESSION_SORTS`/`SESSION_STATUS_RANK`.
 *
 * Pure: `now` is a parameter so calendar-day bucketing is deterministic in tests.
 */
import type { SessionItem } from './chat-to-thread-custom';

export type SortMode = 'recent' | 'name' | 'status';

export const SESSION_SORTS = [
  { id: 'recent', label: 'Recent activity' },
  { id: 'name', label: 'Name (A–Z)' },
  { id: 'status', label: 'Status' },
] as const;

const SESSION_STATUS_RANK: Record<string, number> = {
  working: 0,
  waiting: 1,
  idle: 2,
};

export interface SessionGroupResult {
  label: string;
  items: SessionItem[];
}

/** Local calendar-day key (YYYY-MM-DD via getFullYear/getMonth/getDate). */
function dayKey(ts: number): number {
  const d = new Date(ts);
  return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
}

function byUpdatedDesc(a: SessionItem, b: SessionItem): number {
  return b.custom.updatedAt - a.custom.updatedAt;
}

function arrangeRecent(pinned: SessionItem[], rest: SessionItem[], now: number): SessionGroupResult[] {
  const todayKey = dayKey(now);
  const yesterdayKey = dayKey(now - 86_400_000);

  const today: SessionItem[] = [];
  const yesterday: SessionItem[] = [];
  const earlier: SessionItem[] = [];
  for (const it of rest) {
    const k = dayKey(it.custom.updatedAt);
    if (k === todayKey) today.push(it);
    else if (k === yesterdayKey) yesterday.push(it);
    else earlier.push(it);
  }

  const out: SessionGroupResult[] = [];
  if (pinned.length > 0) out.push({ label: 'Pinned', items: [...pinned].sort(byUpdatedDesc) });
  if (today.length > 0) out.push({ label: 'Today', items: today.sort(byUpdatedDesc) });
  if (yesterday.length > 0) out.push({ label: 'Yesterday', items: yesterday.sort(byUpdatedDesc) });
  if (earlier.length > 0) out.push({ label: 'Earlier', items: earlier.sort(byUpdatedDesc) });
  return out;
}

function arrangeFlat(pinned: SessionItem[], rest: SessionItem[], label: string): SessionGroupResult[] {
  const out: SessionGroupResult[] = [];
  if (pinned.length > 0) out.push({ label: 'Pinned', items: pinned });
  out.push({ label, items: rest });
  return out;
}

/**
 * Group + sort the (already-filtered) session list per the active sort mode.
 * Pinned items are always lifted into a leading 'Pinned' group (omitted when empty).
 */
export function arrangeSessions(items: SessionItem[], mode: SortMode, now: number = Date.now()): SessionGroupResult[] {
  const pinned = items.filter((i) => i.custom.pinned);
  const rest = items.filter((i) => !i.custom.pinned);

  if (mode === 'name') {
    const sorted = [...rest].sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
    return arrangeFlat(pinned, sorted, 'A–Z');
  }

  if (mode === 'status') {
    const sorted = [...rest].sort(
      (a, b) => (SESSION_STATUS_RANK[a.custom.displayStatus] ?? 3) - (SESSION_STATUS_RANK[b.custom.displayStatus] ?? 3),
    );
    return arrangeFlat(pinned, sorted, 'By status');
  }

  return arrangeRecent(pinned, rest, now);
}
