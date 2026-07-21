/**
 * resetNewThreadDraft — clear the stale draft-config + ready flag for the current
 * (reused) new-thread slot before a fresh New action.
 *
 * assistant-ui's RemoteThreadList keeps a SINGLE `newThreadId` slot and reuses the
 * same `__LOCALID_*` id for every New until a message is sent commits it. The
 * new-thread coordinator only clears the draft/ready on that successful first send,
 * so an ABANDONED draft (the user switched sessions or changed the filter pill
 * without sending) survives on the reused id. The next New then reuses it, and the
 * stale draft/ready short-circuit the auto-config re-seed (`getDraftConfig` guard)
 * and the picker gate (`!isReady`) — creating the chat in the stale project instead
 * of the active filter's project (or skipping the project picker in the "All" view).
 *
 * Calling this at the start of each New action resets the slot so the draft always
 * reflects the CURRENT context. No-op when the slot is empty (undefined/null) — a
 * committed thread has already had its draft cleared by the coordinator.
 *
 * Also clears the discarded-draft suppression marker (see discarded-drafts.ts):
 * this function IS the canonical "start a fresh New action" reset point, so a
 * genuinely new New for a recycled localId must arm normally, not stay
 * suppressed from a previous discard on that same slot.
 */
import { clearDraftConfig } from '../runtime/draft-config';
import { useNewThreadReady } from '../runtime/new-thread-ready-store';
import { abandonCreateForLocal } from '../runtime/new-thread-coordinator';
import { clearDraftDiscarded } from './discarded-drafts';

export function resetNewThreadDraft(newThreadId: string | null | undefined): void {
  if (!newThreadId) return;
  abandonCreateForLocal(newThreadId);
  clearDraftConfig(newThreadId);
  useNewThreadReady.getState().clearReady(newThreadId);
  clearDraftDiscarded(newThreadId);
}
