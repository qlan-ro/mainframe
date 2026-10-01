/**
 * Owns the visible accumulator, an optional staging accumulator, and
 * `firstSeenAt` for one `AcpSessionPlane` (D4 client half, long-chat-and-
 * streaming plan task U2). A full replay builds off-screen in a fresh
 * accumulator and is published in one swap — no item ever mounts twice under
 * two different generations. A cursor replay (and ordinary live traffic)
 * applies straight to the visible accumulator, exactly as before.
 */
import {
  AcpItemAccumulator,
  type AccumulatedItem,
  type AcpItemAccumulatorOptions,
} from '../view-model/acp-item-accumulator';

export class AcpTranscriptStore {
  private visible: AcpItemAccumulator;
  private staging: AcpItemAccumulator | null = null;
  private readonly firstSeenAt = new Map<string, Date>();

  /**
   * `resolveOptions` is called fresh every time a new accumulator is built
   * (construction, `beginFullReplay()`, `resetAll()`) rather than captured
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

  /** True while a full replay is staging off-screen (the visible transcript is untouched). */
  get isStaging(): boolean {
    return this.staging !== null;
  }

  /** Where an incoming frame applies right now. */
  target(): AcpItemAccumulator {
    return this.staging ?? this.visible;
  }

  /** A full replay's frames go into a fresh, isolated accumulator — the visible one is left alone until `publishStaging()`. */
  beginFullReplay(): void {
    this.staging = new AcpItemAccumulator(this.resolveOptions());
    this.staging.setReplaying(true);
  }

  /** A cursor replay's frames apply straight to the visible accumulator, marked replay-origin. */
  beginCursorReplay(): void {
    this.visible.setReplaying(true);
  }

  /** Cursor replay closed (successfully or aborted) — stop marking new items replay-origin. */
  endCursorReplay(): void {
    this.visible.setReplaying(false);
  }

  /** Swaps the staged accumulator in as visible — one reference swap, no per-item copy. Returns its items for the single `transcript.updated` dispatch. */
  publishStaging(): AccumulatedItem[] {
    if (this.staging) {
      this.visible = this.staging;
      this.staging = null;
      this.firstSeenAt.clear();
    }
    return this.visible.itemsInOrder;
  }

  /** The staged work is thrown away — an aborted or daemon-aborted full window. The visible transcript is untouched. */
  discardStaging(): void {
    this.staging = null;
  }

  /** A real server-side wipe (`transcript_cleared`) or the legacy reset-at-reply path. */
  resetAll(): void {
    this.visible = new AcpItemAccumulator(this.resolveOptions());
    this.staging = null;
    this.firstSeenAt.clear();
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
