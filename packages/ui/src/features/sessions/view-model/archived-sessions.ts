/**
 * Pure helper: derive the archived session list from the live SessionItem array.
 *
 * Mirrors desktop's filterArchivedChats but operates on SessionItem (the
 * view-model projection, not raw Chat) so no extra API call is needed.
 * Project match uses custom.projectId — the same field SessionRow uses.
 */
import type { SessionItem } from './chat-to-thread-custom';

/**
 * Keep items whose status === 'archived', optionally narrowed to a single
 * project, sorted by updatedAt descending (most recently touched first).
 */
export function filterArchivedSessions(items: SessionItem[], projectIds: ReadonlySet<string>): SessionItem[] {
  return items
    .filter((item) => item.status === 'archived' && (projectIds.size === 0 || projectIds.has(item.custom.projectId)))
    .sort((a, b) => b.custom.updatedAt - a.custom.updatedAt);
}

/**
 * The project label for one archived row: "No project" for a chat with no
 * real project, its resolved name, or "Unknown project" as a last resort (a
 * removed project's id is still on the row, but absent from the live list).
 * `noProject` is checked first — a non-project chat's `projectId` is the
 * daemon's hidden scratch project, never a real (possibly removed) one, so it
 * must never fall through to "Unknown project" (todo #346).
 */
export function archivedRowProjectName(item: SessionItem, projectNames: ReadonlyMap<string, string>): string {
  if (item.custom.noProject) return 'No project';
  return projectNames.get(item.custom.projectId) ?? 'Unknown project';
}
