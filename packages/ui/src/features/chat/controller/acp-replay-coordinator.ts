/**
 * Owns the window FIFO plus the post-reply continuation that used to live
 * inline in `AcpSessionAttachment.resume()` — split out once that file
 * crossed 300 lines (D4, plan task U2). `AcpSessionAttachment` still owns
 * the client/subscription/generation and the raw `resume()` RPC call; this
 * class decides what a reply means once it arrives. The window/FIFO data
 * structures themselves live in `acp-replay-window.ts`.
 */
import { ReplayCancelledError, ReplayWindow, ReplayWindowFifo, type ReplayWindowKind } from './acp-replay-window';
import type { ReplayStage } from './acp-replay-stage';
import type { ChatStateEvent } from './chat-thread-state';

/** What `ReplayWindowCoordinator` needs from `AcpSessionAttachmentHost` — a view, not the whole interface, so the coordinator stays independent of the attachment's own state. */
/** The two generations a window is tagged with at open time — the attachment's own subscription generation, and the client's connection generation (finding 1 of the independent review). */
export interface WindowIdentity {
  generation: number;
  connectionGeneration: number;
}

export interface ReplayCoordinatorHost {
  getChatId(): string;
  dispatch(event: ChatStateEvent): void;
  hasAccumulatedItems(): boolean;
  resetAccumulator(): void;
  beginReplay(opts: { full: boolean }): ReplayStage;
  completeReplay(stage: ReplayStage): void;
  discardReplay(stage: ReplayStage): void;
  /** True from the moment a `resume()` request is sent until its window settles (attachment-owned; the coordinator only reads it). */
  isResumePending(): boolean;
}

export class ReplayWindowCoordinator {
  private readonly fifo = new ReplayWindowFifo();
  private hasAttachedOnce = false;

  constructor(private readonly host: ReplayCoordinatorHost) {}

  /** A first-ever attach needs the full-replay `attach()` path; a genuine switch-back resumes from the settled cursor instead (D2). */
  get hasAttached(): boolean {
    return this.hasAttachedOnce;
  }

  hasOpenWindow(): boolean {
    return this.fifo.front()?.status === 'open';
  }

  /** The FIFO-front window's own stage — where a routed frame applies (todo #385). `null` while the FIFO is empty or its front window was refused. */
  currentStage(): ReplayStage | null {
    return this.fifo.front()?.stage ?? null;
  }

  /** A resync superseded the oldest still-open window (never this instance's own in-flight run — `FullReplayRetry` already dedupes that case). Its staging, if any, stays reachable until its own marker arrives. */
  abortOpenWindow(): void {
    const front = this.fifo.front();
    if (!front || front.status !== 'open') return;
    front.abort(new ReplayCancelledError(`[acp-session] a newer replay superseded ${this.host.getChatId()}`));
  }

  /**
   * A gap (silence, a sequence gap, or the socket closing — the facade
   * client fires the same event for all three). Every open window is
   * aborted but STAYS in the FIFO: its staging (if any) keeps absorbing and
   * discarding frames until its own `replay_complete` arrives, because a
   * live frame destined for it could already be in flight, and `target()`
   * must never let it fall through to the visible accumulator.
   */
  abortOpenWindowsOnGap(): void {
    for (const window of this.fifo.openWindows()) {
      window.abort(new ReplayCancelledError(`[acp-session] a gap superseded a replay for ${this.host.getChatId()}`));
    }
  }

  /**
   * A detach, dispose, or client rebind: no marker can ever arrive again on
   * this binding, so every window is drained outright rather than left
   * waiting for a marker that will never come. A drained full window's
   * staging is discarded immediately — otherwise it would silently keep
   * absorbing (and `target()` would keep routing to) frames forever.
   */
  cancelAll(): void {
    for (const window of this.fifo.drain()) {
      window.abort(new ReplayCancelledError(`[acp-session] replay for ${this.host.getChatId()} was cancelled`));
      if (window.stage) this.host.discardReplay(window.stage);
    }
  }

  /**
   * A reconnect (a NEW underlying connection, not a live-socket gap):
   * every window still queued was opened on the connection that just died,
   * so its own `replay_complete` can never arrive — settle and discard it
   * now, exactly like `cancelAll()`, rather than leaving it queued ahead of
   * whatever the reconnect's own gap-resume opens next. A window already
   * tagged with the NEW connection (there shouldn't be one yet, but
   * defensively) is left untouched (finding 1 of the independent review:
   * without this, a stale window sat in the FIFO forever, and the next
   * resume's marker closed IT instead of the new one, discarding the new
   * window's staging through the shared slot and leaving it settled on
   * nothing).
   */
  cancelStaleConnection(currentConnectionGeneration: number): void {
    for (const window of this.fifo.drainStale(currentConnectionGeneration)) {
      window.abort(
        new ReplayCancelledError(
          `[acp-session] the connection for ${this.host.getChatId()} reconnected, invalidating a queued replay`,
        ),
      );
      if (window.stage) this.host.discardReplay(window.stage);
    }
  }

  /** Tracks a frame's creation against the currently-open window, for the `itemCount` cross-check at publish (advisory only). */
  recordApplyOutcome(outcome: { created: boolean }): void {
    this.fifo.front()?.recordApplyOutcome(outcome);
  }

  /** D3 routing: an unknown-id frame with no creation marker. Redundant with an in-flight replay, which will resolve it on its own. */
  routeNeedsReplay(requestResync: () => void): void {
    if (this.host.isResumePending()) {
      console.warn(`[acp-session] needs-replay for ${this.host.getChatId()} while a resume is pending — ignoring`);
      return;
    }
    requestResync();
  }

  /**
   * Runs one resume's post-reply continuation. Without the capability, this
   * is the legacy reset-at-reply path, settled synchronously. With it, a
   * window is pushed and this call stays pending until that window settles
   * — its own `replay_complete`, or an earlier abort.
   */
  async continueResume(
    staged: boolean,
    isFullReplay: boolean,
    itemCount: number | null,
    ids: WindowIdentity,
    opts: { bypassGuard?: boolean },
  ): Promise<void> {
    if (!staged) {
      this.legacyContinuation(isFullReplay, itemCount, opts);
      return;
    }
    await this.openWindow(isFullReplay, itemCount, ids, opts);
  }

  /** Closes the FIFO's oldest window — regardless of its status, because replies and markers for one session pair up in FIFO order (spec Decision 38). */
  handleReplayComplete(aborted: boolean): void {
    const window = this.fifo.closeOldest();
    if (!window) {
      console.warn(`[acp-session] replay_complete for ${this.host.getChatId()} with no open window`);
      return;
    }
    if (window.status === 'aborted') {
      // Already settled client-side (gap/resync/detach) — this marker is
      // pure bookkeeping: drop any staging THIS window was still holding
      // onto, never another window's.
      if (window.stage) this.host.discardReplay(window.stage);
      return;
    }
    if (window.kind === 'refused') {
      window.settleResolve();
      return;
    }
    if (aborted) {
      if (window.stage) this.host.discardReplay(window.stage);
      window.settleReject(new Error(`[acp-session] resume for ${this.host.getChatId()} was aborted by the daemon`));
      return;
    }
    this.warnOnItemCountMismatch(window);
    if (window.stage) this.host.completeReplay(window.stage);
    window.settleResolve();
  }

  /**
   * Refuses an empty full replay of a transcript we already hold — the
   * legacy `refusesEmptyRefresh` guard: "empty" from the daemon can mean
   * "no history session for this chat yet", never trust it to blank a
   * populated thread (the first attach is never refused, so a genuinely
   * empty thread still renders as one). `bypassGuard: true` (a wipe) skips
   * it — a server-initiated wipe must win regardless.
   */
  private legacyContinuation(isFullReplay: boolean, itemCount: number | null, opts: { bypassGuard?: boolean }): void {
    if (!isFullReplay) return;
    if (this.isRefused(isFullReplay, itemCount, opts)) {
      this.dispatchRefused();
      return;
    }
    // After the guard, never before: the first full replay must stay
    // un-refusable, and the guard reads this flag.
    this.hasAttachedOnce = true;
    this.host.resetAccumulator();
  }

  private async openWindow(
    isFullReplay: boolean,
    itemCount: number | null,
    ids: WindowIdentity,
    opts: { bypassGuard?: boolean },
  ): Promise<void> {
    // A reconnect can beat THIS attachment's own gap signal to the punch —
    // another caller's direct `ensureConnected()` can land a new connection
    // (and this request can go out and come back on it) before the dead
    // connection's scheduled-reconnect `notifyGap()` ever reaches us (it can
    // lag up to its own backoff ceiling). Draining here, keyed off the
    // connection THIS request just used, catches that race even when
    // `resumeFromGap()`'s own drain never ran — remaining path of finding 1
    // of the independent review. `cancelStaleConnection` is idempotent, so
    // this is a no-op on the ordinary path where `resumeFromGap()` already
    // drained everything.
    this.cancelStaleConnection(ids.connectionGeneration);
    const kind: ReplayWindowKind = this.isRefused(isFullReplay, itemCount, opts)
      ? 'refused'
      : isFullReplay
        ? 'full'
        : 'cursor';
    const window = new ReplayWindow(kind, itemCount, ids.generation, ids.connectionGeneration);
    this.fifo.push(window);

    if (kind === 'refused') {
      this.dispatchRefused();
    } else if (kind === 'full') {
      // After the guard, never before — same ordering reason as the legacy path.
      this.hasAttachedOnce = true;
      window.stage = this.host.beginReplay({ full: true });
    } else {
      window.stage = this.host.beginReplay({ full: false });
    }

    await window.promise;
  }

  private isRefused(isFullReplay: boolean, itemCount: number | null, opts: { bypassGuard?: boolean }): boolean {
    return (
      isFullReplay && !opts.bypassGuard && itemCount === 0 && this.hasAttachedOnce && this.host.hasAccumulatedItems()
    );
  }

  private dispatchRefused(): void {
    console.warn(`[acp-session] refused an empty full replay for ${this.host.getChatId()}`);
    this.host.dispatch({ type: 'history.refresh.refused' });
  }

  /** Full windows only: a cursor resume's `itemCount` is the whole snapshot but it creates just the items past the cursor. */
  private warnOnItemCountMismatch(window: ReplayWindow): void {
    if (window.kind === 'full' && window.itemCount !== null && window.itemCount !== window.createdCount) {
      console.warn(
        `[acp-session] resume itemCount mismatch for ${this.host.getChatId()}: expected ${window.itemCount}, created ${window.createdCount}`,
      );
    }
  }
}
