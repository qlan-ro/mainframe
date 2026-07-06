/**
 * resolveProjectSession — pure function for picking which session to open when
 * the user activates a project filter pill.
 *
 * Priority:
 *   1. Remembered session (lastByProject[projectId]) — when it is still alive
 *      (non-archived, present in the list) for this project.
 *   2. Most-recently-updated non-archived session in the project, via
 *      pickInitialSession.
 *   3. null — no sessions in the project.
 *
 * Returns the aui thread `id` (not the daemon remote id) so the caller can
 * pass it directly to `runtime.threads.switchToThread`.
 */
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import { pickInitialSession } from '@/features/sessions/view-model/initial-session';

export function resolveProjectSession(
  items: SessionItem[],
  projectId: string,
  lastByProject: Record<string, string>,
): string | null {
  const inProject = items.filter((i) => i.custom.projectId === projectId && i.status !== 'archived');
  if (inProject.length === 0) return null;

  const remembered = lastByProject[projectId];
  if (remembered != null) {
    const hit = inProject.find((i) => i.remoteId === remembered || i.id === remembered);
    if (hit != null) return hit.id;
  }

  return pickInitialSession(inProject, null);
}
