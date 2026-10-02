/**
 * Owns the visible accumulator and every open full-replay stage's off-screen
 * accumulator, for one `AcpSessionPlane` (D4 client half, long-chat-and-
 * streaming plan task U2; per-window ownership, todo #385). A full replay
 * builds off-screen in its OWN fresh accumulator (`openStage(true)`) and is
 * published in one swap — no item ever mounts twice under two different
 * generations, and a second, overlapping full replay gets its own
 * accumulator rather than replacing the first one's. A cursor replay (and
 * ordinary live traffic) applies straight to the visible accumulator, exactly
 * as before — `ReplayStage` just carries that window's deferred state.
 */
import {
  AcpItemAccumulator,
  type AccumulatedItem,
  type AcpItemAccumulatorOptions,
  type ApplyOutcome,
} from '../view-model/acp-item-accumulator';
import type { SessionUpdate } from '@qlan-ro/mainframe-types';
import { ReplayStage } from './acp-replay-stage';

export class AcpTranscriptStore {
  private visible: AcpItemAccumulator;
  /** Every still-open FULL stage — the only kind `resetAll()` must protect against a late, post-wipe publish. A cursor stage never touches `visible` through `publish()`, so it needs no bookkeeping here. */
  private readonly openFullStages = new Set<ReplayStage>();
  private readonly firstSeenAt = new Map<string, Date>();

  /**
   * `resolveOptions` is called fresh every time a new accumulator is built
   * (construction, `openStage(true)`, `resetAll()`) rather than captured
   * once — the daemon's advertised capabilities are only known once a client
   * has attached, which happens after this store (owned by the plane) is
   * constructed.
   */
  constructor(private readonly resolveOptions: () => AcpItemAccumulatorOptions) {
    this.visible = new AcpItemAccumulator(resolveOptions());
  }

  /** The published accumulator — what `refreshMessages()`/gates/reconcile read. */
  get accumulator(): AcpItemAccumulator {
    return this.visible;
  }

  /** A new replay window opened — the window (via its coordinator) owns the returned stage from here on. */
  openStage(full: boolean): ReplayStage {
    const accumulator = full ? new AcpItemAccumulator(this.resolveOptions()) : null;
    accumulator?.setReplaying(true);
    const stage = new ReplayStage(full, accumulator);
    if (full) this.openFullStages.add(stage);
    return stage;
  }

  /**
   * Applies one frame to its routed window's own storage. A full stage
   * applies to its own accumulator regardless of status, so an aborted
   * window keeps absorbing (and discarding) its remaining frames instead of
   * ever falling through to `visible`. Anything else — a cursor stage, or no
   * stage at all — applies straight to `visible`, marked replay-origin only
   * while a cursor stage is routing it.
   */
  apply(update: SessionUpdate, stage: ReplayStage | null): ApplyOutcome {
    if (stage?.full) return stage.accumulator!.apply(update);
    this.visible.setReplaying(stage !== null && !stage.full);
    return this.visible.apply(update);
  }

  /**
   * Swaps an open full stage's accumulator in as `visible` — one reference
   * swap, no per-item copy — and returns its items for the single
   * `transcript.updated` dispatch. A no-op (returns `null`) for a cursor
   * stage, or a stage that already published/discarded: a duplicate or stale
   * `completeReplay` call dispatches nothing.
   */
  publish(stage: ReplayStage): AccumulatedItem[] | null {
    if (stage.status !== 'open' || !stage.full) return null;
    this.visible = stage.accumulator!;
    // The published accumulator must stop marking new items replay-origin
    // the instant it goes live, or every subsequently-created item (every
    // chat full-replays on attach) gets an explicit `complete` status
    // forever, and a later streaming item's own final block pops instead
    // of animating (finding 2 of the independent review).
    this.visible.setReplaying(false);
    this.firstSeenAt.clear();
    stage.status = 'published';
    this.openFullStages.delete(stage);
    return this.visible.itemsInOrder;
  }

  /** The staged work is thrown away — an aborted or daemon-aborted window. Idempotent; the visible transcript is untouched. */
  discard(stage: ReplayStage): void {
    if (stage.status !== 'open') return;
    stage.status = 'discarded';
    this.openFullStages.delete(stage);
  }

  /** A real server-side wipe (`transcript_cleared`) or the legacy reset-at-reply path. A full window already staging keeps absorbing its remaining frames (its accumulator object is untouched) but can never publish pre-wipe content — `publish()`'s status check now fails it. */
  resetAll(): void {
    this.visible = new AcpItemAccumulator(this.resolveOptions());
    this.firstSeenAt.clear();
    for (const stage of this.openFullStages) stage.status = 'discarded';
    this.openFullStages.clear();
  }

  /** Stamps (and remembers) the first time this id was seen, for `convertAcpItems`'s per-item mount timestamp. */
  firstSeenAtOf(id: string, now: () => Date): Date {
    const existing = this.firstSeenAt.get(id);
    if (existing) return existing;
    const stamped = now();
    this.firstSeenAt.set(id, stamped);
    return stamped;
  }
}
