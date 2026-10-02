/**
 * One replay window's own storage (todo #385, follow-up to D4/U2): a full
 * window's off-screen accumulator and its deferred `state_update`, or a
 * cursor window's placeholder (no accumulator of its own — its frames apply
 * straight to the visible one). `AcpTranscriptStore` creates a stage per
 * `openStage()` call and the window that opened it (`ReplayWindow.stage`) is
 * the only thing that ever references it again, so two windows can never
 * trade frames or publish/discard each other's state through a shared slot.
 *
 * `status` only ever moves one way, `open → published | discarded`, and only
 * matters for a FULL stage: it gates whether `AcpTranscriptStore.publish()`
 * may still swap this stage's accumulator in as `visible` (never twice, and
 * never after a wipe discarded it). A cursor stage's `status` is cosmetic —
 * its frames are routed live by `AcpTranscriptStore.apply()` regardless of
 * status, so nothing ever reads it.
 */
import type { SessionUpdate } from '@qlan-ro/mainframe-types';
import type { AcpItemAccumulator } from '../view-model/acp-item-accumulator';

export type ReplayStageStatus = 'open' | 'published' | 'discarded';

export class ReplayStage {
  status: ReplayStageStatus = 'open';
  /**
   * Captured while this stage is staging (full) or live (cursor) — applied
   * once this stage's own `completeReplay()` runs, against the items that
   * stage actually published. Never dispatched live mid-replay.
   */
  pendingState: Extract<SessionUpdate, { sessionUpdate: 'state_update' }> | null = null;

  constructor(
    readonly full: boolean,
    /** `null` for a cursor stage — it has no off-screen accumulator of its own. */
    readonly accumulator: AcpItemAccumulator | null,
  ) {}
}
