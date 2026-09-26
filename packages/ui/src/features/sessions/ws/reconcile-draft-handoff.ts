/**
 * reconcileDraftHandoff — extracted out of useSessionListRouter to keep that
 * hook under the file's line budget (todo #346).
 *
 * While on a draft, reconciles `prevRealActiveRef` (the last real thread the
 * user was on) against the current list. Returns a fallback id to switch to,
 * or null when nothing should move. Two distinct cases collapse into one ref:
 *
 *  - Deliberate New away from that exact thread (`useDraftReturnTarget` stamps
 *    it as the draft's return target at the moment New is clicked): hand
 *    "getting back to it" to `useDraftRow`'s own return-target flow and stop
 *    watching it here — otherwise a LATER, unrelated archive/discard of that
 *    (no longer active) thread would still match `prevRealActiveId` and yank
 *    the user off a draft they opened and typed into on purpose (chat T →
 *    New → type → discard T from the sidebar).
 *  - Involuntary bump: aui `switchToNewThread()`s off an archived OR deleted
 *    thread (a discard removes the entry outright rather than flagging it —
 *    todo #346), landing on an empty draft. Redirect to a fallback
 *    instead of stranding the user there.
 */
import { useDraftReturnTarget } from '../new-thread/use-draft-return-target';
import type { SessionItem } from '../view-model/chat-to-thread-custom';

export function reconcileDraftHandoff(
  prevRealActiveRef: { current: string | null },
  items: readonly SessionItem[],
  fallback: () => string | null,
): string | null {
  const prevRealActiveId = prevRealActiveRef.current;
  if (prevRealActiveId == null) return null;
  if (useDraftReturnTarget.getState().returnThreadId === prevRealActiveId) {
    prevRealActiveRef.current = null;
    return null;
  }
  const leftItem = items.find((t) => t.id === prevRealActiveId);
  const leftThreadGone = leftItem?.status === 'archived' || leftItem == null;
  if (!leftThreadGone) return null;
  const target = fallback();
  if (target != null) prevRealActiveRef.current = null;
  return target;
}
