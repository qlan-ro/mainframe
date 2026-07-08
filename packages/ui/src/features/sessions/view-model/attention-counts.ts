/**
 * Counts sessions in a project that need attention: unread OR has a pending
 * permission request. Each session counts once even if both flags are set.
 *
 * unread is injected as a callback from the client-side unread store rather
 * than embedded in SessionCustom, keeping the view-model side-effect-free.
 */
import type { SessionItem } from './chat-to-thread-custom';
import { isSessionUnreadById } from './session-unread';

export function attentionCount(items: SessionItem[], isUnread: (id: string) => boolean, projectId: string): number {
  return items.filter(
    (i) => i.custom.projectId === projectId && (isSessionUnreadById(i, isUnread) || i.custom.hasPending),
  ).length;
}
