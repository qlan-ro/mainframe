/**
 * Owns the window FIFO plus the post-reply continuation that used to live
 * inline in `AcpSessionAttachment.resume()` — split out once that file
 * crossed 300 lines (D4, plan task U2). `AcpSessionAttachment` still owns
 * the client/subscription/generation and the raw `resume()` RPC call; this
 * class decides what a reply means once it arrives. The window/FIFO data
 * structures themselves live in `acp-replay-window.ts`.
 */
import { ReplayCancelledError, ReplayWindow, ReplayWindowFifo, type ReplayWindowKind } from './acp-replay-window';
import type { ChatStateEvent } from './chat-thread-state';

/** What `ReplayWindowCoordinator` needs from `AcpSessionAttachmentHost` — a view, not the whole interface, so the coordinator stays independent of the attachment's own state. */
export interface ReplayCoordinatorHost {
  getChatId(): string;
  dispatch(event: ChatStateEvent): void;
  hasAccumulatedItems(): boolean;
  resetAccumulator(): void;
  beginReplay(opts: { full: boolean }): void;
  completeReplay(opts: { full: boolean }): void;
  discardReplay(opts: { full: boolean }): void;
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
      if (window.kind === 'full') this.host.discardReplay({ full: true });
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
    generation: number,
    opts: { bypassGuard?: boolean },
  ): Promise<void> {
    if (!staged) {
      this.legacyContinuation(isFullReplay, itemCount, opts);
      return;
    }
    await this.openWindow(isFullReplay, itemCount, generation, opts);
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
      // pure bookkeeping: drop any staging it was still holding onto.
      if (window.kind === 'full') this.host.discardReplay({ full: true });
      return;
    }
    if (window.kind === 'refused') {
      window.settleResolve();
      return;
    }
    if (aborted) {
      this.host.discardReplay({ full: window.kind === 'full' });
      window.settleReject(new Error(`[acp-session] resume for ${this.host.getChatId()} was aborted by the daemon`));
      return;
    }
    this.warnOnItemCountMismatch(window);
    this.host.completeReplay({ full: window.kind === 'full' });
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
    generation: number,
    opts: { bypassGuard?: boolean },
  ): Promise<void> {
    const kind: ReplayWindowKind = this.isRefused(isFullReplay, itemCount, opts)
      ? 'refused'
      : isFullReplay
        ? 'full'
        : 'cursor';
    const window = new ReplayWindow(kind, itemCount, generation);
    this.fifo.push(window);

    if (kind === 'refused') {
      this.dispatchRefused();
    } else if (kind === 'full') {
      // After the guard, never before — same ordering reason as the legacy path.
      this.hasAttachedOnce = true;
      this.host.beginReplay({ full: true });
    } else {
      this.host.beginReplay({ full: false });
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

  private warnOnItemCountMismatch(window: ReplayWindow): void {
    if (window.itemCount !== null && window.itemCount !== window.createdCount) {
      console.warn(
        `[acp-session] resume itemCount mismatch for ${this.host.getChatId()}: expected ${window.itemCount}, created ${window.createdCount}`,
      );
    }
  }
}
