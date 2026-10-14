/**
 * Sessions sidebar view-model: arrange the filtered session list into the
 * warm-chrome artboard's groups.
 *
 * The default grouping is TIME (Pinned / Today / Yesterday / Earlier), not
 * project — project narrowing is primarily the project switcher list + the
 * per-row project chip. A "Project" Sort By mode is additionally offered
 * (`mode: 'project'`) for anyone who wants project-grouped sections instead;
 * it does not change the default. See `arrangeByProject` below.
 *
 * Pure: `now` is a parameter so calendar-day bucketing is deterministic in tests.
 *
 * A non-project chat (`custom.noProject`) is pulled out before any day or
 * project bucketing and always lands in its own trailing "No project" group —
 * in 'recent' mode after Earlier, in 'project' mode after every ghost section
 * (todo #346). It must never fall into a ghost section: ghost sections key off
 * a session's raw `projectId`, and a no-project chat's `projectId` is the
 * daemon's hidden scratch project id, not a real (removed) project.
 *
 * Every placement decision (pinned, no-project, day bucket, project) reads a
 * lineage's anchor rather than the chat itself, so a fork always lands in its
 * parent's group and nests there (todo #395). In time-ordered sections a
 * lineage sorts and buckets by its freshest member: an active fork lifts its
 * idle parent into Today instead of being buried under it in Earlier.
 */
import type { SessionItem } from './chat-to-thread-custom';
import { lineageAnchors, nestForks } from './fork-lineage';

export type SortMode = 'recent' | 'name' | 'status' | 'project';

export const SESSION_SORTS = [
  { id: 'recent', label: 'Recent activity' },
  { id: 'name', label: 'Name (A–Z)' },
  { id: 'status', label: 'Status' },
  { id: 'project', label: 'Project' },
] as const;

const SESSION_STATUS_RANK: Record<string, number> = {
  working: 0,
  waiting: 1,
  idle: 2,
};

export interface SessionGroupResult {
  label: string;
  items: SessionItem[];
  /** Nesting depth (1 or 2) per item id, from `nestForks`. Absent = not nested (depth 0). */
  depths: Record<string, 1 | 2>;
}

/**
 * Builds one group: `nestForks` reorders `sortedItems` into contiguous
 * parent-then-descendants blocks (a no-op when no item in this group forks
 * another item already in it) and yields the per-id indent depth.
 */
function toGroup(label: string, sortedItems: SessionItem[]): SessionGroupResult {
  const rows = nestForks(sortedItems);
  const depths: Record<string, 1 | 2> = {};
  for (const row of rows) {
    if (row.depth === 1 || row.depth === 2) depths[row.item.id] = row.depth;
  }
  return { label, items: rows.map((row) => row.item), depths };
}

/** Local calendar-day key (YYYY-MM-DD via getFullYear/getMonth/getDate). */
function dayKey(ts: number): number {
  const d = new Date(ts);
  return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
}

/** Code-unit order, not `localeCompare`, so the result cannot vary with the host locale. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Newest first; id breaks ties because incoming array order is only "when this client first saw it". */
function byRecency(a: SessionItem, b: SessionItem): number {
  return b.custom.updatedAt - a.custom.updatedAt || compareStrings(a.id, b.id);
}

interface Lineage {
  /** The item that decides this item's group — see `lineageAnchors`. */
  anchorOf(it: SessionItem): SessionItem;
  /** Newest `updatedAt` across everything sharing this item's anchor. */
  latestOf(it: SessionItem): number;
  /** Freshest lineage first, then the item's own recency (orders siblings). */
  byRecency(a: SessionItem, b: SessionItem): number;
}

function buildLineage(items: readonly SessionItem[]): Lineage {
  const anchors = lineageAnchors(items);
  const anchorOf = (it: SessionItem) => anchors.get(it.id) ?? it;
  const latest = new Map<string, number>();
  for (const it of items) {
    const id = anchorOf(it).id;
    latest.set(id, Math.max(latest.get(id) ?? -Infinity, it.custom.updatedAt));
  }
  const latestOf = (it: SessionItem) => latest.get(anchorOf(it).id) ?? it.custom.updatedAt;
  return { anchorOf, latestOf, byRecency: (a, b) => latestOf(b) - latestOf(a) || byRecency(a, b) };
}

/**
 * Pulls non-project chats out of a (non-pinned) item list, so every grouping
 * mode below builds its normal sections from `rest` alone and appends the
 * no-project items as one trailing group.
 */
function splitNoProject(items: SessionItem[], lineage: Lineage): { noProject: SessionItem[]; rest: SessionItem[] } {
  const noProject: SessionItem[] = [];
  const rest: SessionItem[] = [];
  for (const it of items) {
    (lineage.anchorOf(it).custom.noProject ? noProject : rest).push(it);
  }
  return { noProject, rest };
}

const NO_PROJECT_LABEL = 'No project';

function noProjectSection(items: SessionItem[], lineage: Lineage): SessionGroupResult[] {
  return items.length > 0 ? [toGroup(NO_PROJECT_LABEL, [...items].sort(lineage.byRecency))] : [];
}

function pinnedSection(pinned: SessionItem[], lineage: Lineage): SessionGroupResult[] {
  return pinned.length > 0 ? [toGroup('Pinned', [...pinned].sort(lineage.byRecency))] : [];
}

function arrangeRecent(
  pinned: SessionItem[],
  rest: SessionItem[],
  now: number,
  lineage: Lineage,
): SessionGroupResult[] {
  const { noProject, rest: dated } = splitNoProject(rest, lineage);
  const todayKey = dayKey(now);
  const yesterdayKey = dayKey(now - 86_400_000);

  const today: SessionItem[] = [];
  const yesterday: SessionItem[] = [];
  const earlier: SessionItem[] = [];
  for (const it of dated) {
    const k = dayKey(lineage.latestOf(it));
    if (k === todayKey) today.push(it);
    else if (k === yesterdayKey) yesterday.push(it);
    else earlier.push(it);
  }

  const out = pinnedSection(pinned, lineage);
  if (today.length > 0) out.push(toGroup('Today', today.sort(lineage.byRecency)));
  if (yesterday.length > 0) out.push(toGroup('Yesterday', yesterday.sort(lineage.byRecency)));
  if (earlier.length > 0) out.push(toGroup('Earlier', earlier.sort(lineage.byRecency)));
  out.push(...noProjectSection(noProject, lineage));
  return out;
}

function arrangeFlat(
  pinned: SessionItem[],
  rest: SessionItem[],
  label: string,
  lineage: Lineage,
): SessionGroupResult[] {
  const out = pinnedSection(pinned, lineage);
  out.push(toGroup(label, rest));
  return out;
}

export interface ProjectRef {
  id: string;
  name: string;
}

/** Sections for projectIds absent from the project list: newest bucket first, then by projectId. */
function ghostSections(buckets: Map<string, SessionItem[]>, lineage: Lineage): SessionGroupResult[] {
  const newest = (g: SessionGroupResult) => (g.items[0] ? lineage.latestOf(g.items[0]) : 0);
  const sections = [...buckets].map(([projectId, items]) => toGroup(projectId, items.sort(lineage.byRecency)));
  return sections.sort((a, b) => newest(b) - newest(a) || compareStrings(a.label, b.label));
}

/**
 * One section per project, ordered by the given project list, each listing its
 * sessions newest-activity first. Sessions whose `projectId` isn't in `projects`
 * (a removed/unknown project) still get a trailing section keyed by that id —
 * grouping never silently drops a session.
 */
function arrangeByProject(
  pinned: SessionItem[],
  rest: SessionItem[],
  projects: ProjectRef[],
  lineage: Lineage,
): SessionGroupResult[] {
  const { noProject, rest: withProject } = splitNoProject(rest, lineage);
  const byProject = new Map<string, SessionItem[]>();
  for (const it of withProject) {
    const projectId = lineage.anchorOf(it).custom.projectId;
    const bucket = byProject.get(projectId);
    if (bucket) bucket.push(it);
    else byProject.set(projectId, [it]);
  }

  const out = pinnedSection(pinned, lineage);
  for (const project of projects) {
    const bucket = byProject.get(project.id);
    if (bucket) {
      out.push(toGroup(project.name, bucket.sort(lineage.byRecency)));
      byProject.delete(project.id);
    }
  }
  out.push(...ghostSections(byProject, lineage));
  out.push(...noProjectSection(noProject, lineage));
  return out;
}

/**
 * Group + sort the (already-filtered) session list per the active sort mode.
 * Pinned items, with their unpinned descendants, are always lifted into a
 * leading 'Pinned' group (omitted when empty).
 */
export function arrangeSessions(
  items: SessionItem[],
  mode: SortMode,
  now: number = Date.now(),
  projects: ProjectRef[] = [],
): SessionGroupResult[] {
  const lineage = buildLineage(items);
  const pinned = items.filter((i) => lineage.anchorOf(i).custom.pinned);
  const rest = items.filter((i) => !lineage.anchorOf(i).custom.pinned);

  if (mode === 'name') {
    const sorted = [...rest].sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '') || byRecency(a, b));
    return arrangeFlat(pinned, sorted, 'A–Z', lineage);
  }

  if (mode === 'status') {
    const sorted = [...rest].sort(
      (a, b) =>
        (SESSION_STATUS_RANK[a.custom.displayStatus] ?? 3) - (SESSION_STATUS_RANK[b.custom.displayStatus] ?? 3) ||
        byRecency(a, b),
    );
    return arrangeFlat(pinned, sorted, 'By status', lineage);
  }

  if (mode === 'project') {
    return arrangeByProject(pinned, rest, projects, lineage);
  }

  return arrangeRecent(pinned, rest, now, lineage);
}
