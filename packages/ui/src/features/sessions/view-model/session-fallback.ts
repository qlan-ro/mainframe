/**
 * pickArchiveFallback — which session to activate when the current one is
 * archived, or when an archive bumped us onto an empty new-thread draft (aui
 * calls `switchToNewThread()` off the archived thread before marking it archived).
 *
 * Two-tier, mirroring boot (`pickInitialSession`): the last-used session if it is
 * still live and non-archived, else the most-recently-updated non-archived
 * session — preferring the active project filter, widening to all sessions only
 * when the filtered project has none left. Returns null when nothing remains to
 * open (the caller then leaves the empty new-thread surface up).
 *
 * Pure.
 */
import type { SessionItem } from './chat-to-thread-custom';
import { pickInitialSession } from './initial-session';

export function pickArchiveFallback(
  items: readonly SessionItem[],
  filterProjectId: string | null,
  preferredRemoteId?: string | null,
): string | null {
  const inProject = filterProjectId != null ? items.filter((i) => i.custom.projectId === filterProjectId) : items;
  return pickInitialSession(inProject, preferredRemoteId) ?? pickInitialSession(items, preferredRemoteId);
}
