/**
 * Owns the two client-side resume cursors for one chat's session plane
 * (todo #377): the legacy settled-item cursor every daemon understands, and
 * the durable `{epoch, revision}` cursor a daemon that negotiates
 * `revisionCursors` returns on every `session/resume` reply. Split out of
 * `AcpSessionPlane` so the selection/commit/notification-advance rules have
 * one place and one test file, instead of being re-derived at
 * `AcpSessionAttachment`'s two call sites (`reactivate`, `resumeFromGap`)
 * (plan docs/plans/2026-10-03-todo-377-revision-resume-cursors-plan.md, G3).
 *
 * The durable cursor only ever moves forward two ways: a completed (never
 * aborted/discarded) replay window commits the `cursor` meta its own
 * `session/resume` reply carried (`commitReplyCursor`, called from
 * `AcpSessionPlane.completeReplay`), and a later `_mainframe.dev/cursor`
 * notification advances it within the SAME epoch while no replay window or
 * resume is in flight (`advanceFromNotification`) — the caller
 * (`AcpSessionAttachment`) gates that "nothing in flight" condition; this
 * class only knows epoch/revision ordering. A different epoch on the
 * notification path means the log rotated server-side since the cursor this
 * class is holding was committed (`transcript_cleared`, `resync`,
 * compaction, or a tool-call vanish all rotate it per the plan's design) —
 * the old cursor is cleared rather than silently replaced by the
 * notification's epoch, which would adopt a boundary with no corresponding
 * seed replay behind it.
 */
import type { MainframeCapabilities, RevisionCursor } from '@qlan-ro/mainframe-types';
import type { ReplayCursor } from '../../../lib/daemon/acp-client';

export class ResumeCursorTracker {
  private lastSettledItemId: string | null = null;
  private durableCursor: RevisionCursor | null = null;

  /** The legacy item cursor — only advanced when the turn goes idle (`AcpSessionPlane.applyStateUpdate`); a cursor into a still-streaming item would drop its tail (resume.rs replays up to and including the cursor at its CURRENT content). */
  getLastSettledItemId(): string | null {
    return this.lastSettledItemId;
  }

  recordSettledItem(itemId: string): void {
    this.lastSettledItemId = itemId;
  }

  /** A wipe/reattach that must forget the settled-item cursor. Leaves the durable revision cursor untouched — callers that also want it gone call `clearDurableCursor()` separately (needs-replay, transcript_cleared, resync — todo #377). */
  resetSettledCursor(): void {
    this.lastSettledItemId = null;
  }

  getDurableCursor(): RevisionCursor | null {
    return this.durableCursor;
  }

  /** A completed replay window's own reply cursor (`ReplayStage.replyCursor`) — call only once that window's `replay_complete` arrived with no abort/discard. `null`/`undefined` (a legacy daemon, or a reply that carried no cursor meta) is a no-op — an interrupted replay must never advance past what it actually applied. */
  commitReplyCursor(cursor: RevisionCursor | null | undefined): void {
    if (!cursor) return;
    this.durableCursor = cursor;
  }

  /** `needs-replay`, `transcript_cleared`, and a resync each invalidate the durable cursor outright (todo #377) — the next full replay's own reply seeds a fresh one via `commitReplyCursor`. */
  clearDurableCursor(): void {
    this.durableCursor = null;
  }

  /**
   * `_mainframe.dev/cursor` (todo #377): advances the durable cursor within
   * its own epoch. No established cursor yet has nothing to advance or
   * rotate away from, so it is a no-op. A different epoch means the log
   * rotated since the last reply committed this cursor — clear it rather
   * than adopt the notification's epoch, which would skip whatever that new
   * epoch's own seed replay was supposed to deliver.
   */
  advanceFromNotification(cursor: RevisionCursor): void {
    if (!this.durableCursor) return;
    if (this.durableCursor.epoch !== cursor.epoch) {
      this.durableCursor = null;
      return;
    }
    if (cursor.revision > this.durableCursor.revision) this.durableCursor = cursor;
  }

  /**
   * The next `session/resume` cursor to send: a revision cursor when the
   * daemon negotiates both `revisionCursors` and `replayComplete` (the
   * reply-cursor commit path only ever runs through a staged replay window)
   * and a durable cursor already exists; `start` for a revision-capable
   * daemon with no durable cursor yet (first-ever attach, or one cleared by
   * an epoch change — `advanceFromNotification`/`clearDurableCursor` — while
   * `lastSettledItemId` survives). An item cursor only ever drops edits to
   * the settled item and everything before it (the bug this todo exists to
   * fix), so it is reserved for a daemon that never negotiated revision
   * cursors at all: the legacy item cursor for a settled transcript there,
   * `start` otherwise.
   */
  nextReplayFrom(capabilities: MainframeCapabilities | null | undefined): ReplayCursor {
    if (capabilities?.revisionCursors === true && capabilities?.replayComplete === true) {
      if (this.durableCursor) {
        return { type: 'revision', epoch: this.durableCursor.epoch, revision: this.durableCursor.revision };
      }
      return { type: 'start' };
    }
    if (this.lastSettledItemId) return { type: 'item', itemId: this.lastSettledItemId };
    return { type: 'start' };
  }
}
