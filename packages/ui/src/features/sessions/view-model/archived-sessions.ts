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
export function filterArchivedSessions(items: SessionItem[], filterProjectId: string | null): SessionItem[] {
  return items
    .filter(
      (item) => item.status === 'archived' && (filterProjectId === null || item.custom.projectId === filterProjectId),
    )
    .sort((a, b) => b.custom.updatedAt - a.custom.updatedAt);
}
