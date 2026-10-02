/**
 * The per-attachment FIFO of `session/resume` replay windows (D4 client
 * half, long-chat-and-streaming plan task U2). One window opens per
 * successful `resume()` reply, once the daemon advertises `replayComplete`
 * (spec Decision 38); it closes — oldest first — on that session's next
 * `_mainframe.dev/replay_complete`, because "replies and markers for one
 * session pair up in FIFO order" on the wire.
 *
 * A window never resolves/rejects on its own initiative outside this
 * module's API — `AcpSessionAttachment` (via `ReplayWindowCoordinator`,
 * `acp-replay-coordinator.ts`) drives every transition (open, close, abort)
 * and `resume()` simply awaits `window.promise`.
 *
 * **Per-window storage (todo #385).** Every window but a refused one owns a
 * `ReplayStage` (`acp-replay-coordinator.ts`'s `openWindow` assigns it right
 * after construction, before any frame can route to this window) — its own
 * off-screen accumulator if full, or just its deferred state if a cursor.
 * Releasing a window (abort, drain, or its own marker) always releases THAT
 * window's own stage, never another window's.
 */

import type { ReplayStage } from './acp-replay-stage';

/** `refused` is the empty-refresh guard's outcome: nothing is staged, nothing publishes, but it still occupies a FIFO slot so markers close in order. */
export type ReplayWindowKind = 'full' | 'cursor' | 'refused';
export type ReplayWindowStatus = 'open' | 'aborted';

/**
 * Settles `resume()` without the noise of a real failure — a detach,
 * dispose, client rebind, or a gap/resync that superseded this window before
 * its own marker arrived. `FullReplayRetry` treats it as a quiet end.
 */
export class ReplayCancelledError extends Error {
  constructor(message = '[acp-session] replay cancelled') {
    super(message);
    this.name = 'ReplayCancelledError';
  }
}

export class ReplayWindow {
  status: ReplayWindowStatus = 'open';
  /** Count of `apply()` calls that created a brand-new item while this window was open — cross-checked against `itemCount` at publish, advisory only. */
  createdCount = 0;
  /** This window's own replay storage — `null` only for a `refused` window, which never stages anything. Set once, immediately after construction (`ReplayWindowCoordinator.openWindow`). */
  stage: ReplayStage | null = null;
  readonly promise: Promise<void>;
  private resolveFn!: () => void;
  private rejectFn!: (error: unknown) => void;
  private settled = false;

  constructor(
    readonly kind: ReplayWindowKind,
    /** `itemCount` from the resume reply's `_meta` — logging only (spec Decision 38). */
    readonly itemCount: number | null,
    /** The attachment's subscription generation this window opened under. */
    readonly generation: number,
    /** The client's connection generation this window's `resume()` request was sent on — a later reconnect invalidates it even though it never got aborted by a live-socket gap. */
    readonly connectionGeneration: number,
  ) {
    this.promise = new Promise<void>((resolve, reject) => {
      this.resolveFn = resolve;
      this.rejectFn = reject;
    });
    // `resume()` always awaits this, but an abort can settle it before that
    // await is wired up (same microtask) — avoid a transient unhandled
    // rejection warning.
    this.promise.catch(() => {});
  }

  recordApplyOutcome(outcome: { created: boolean }): void {
    if (outcome.created) this.createdCount += 1;
  }

  settleResolve(): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveFn();
  }

  settleReject(error: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.rejectFn(error);
  }

  /** Marks this window aborted and settles its `resume()` promise at once — the staging target (if any) is NOT touched here; it stays reachable until this window's own marker pops it. */
  abort(error: unknown): void {
    this.status = 'aborted';
    this.settleReject(error);
  }
}

/** FIFO of in-flight/aborted-but-unclosed replay windows for one attachment. */
export class ReplayWindowFifo {
  private readonly windows: ReplayWindow[] = [];

  get size(): number {
    return this.windows.length;
  }

  push(window: ReplayWindow): void {
    this.windows.push(window);
  }

  /**
   * The oldest window still queued, regardless of status. Frames always
   * belong to it: the daemon never interleaves a later resume's replay
   * ahead of an earlier one's `replay_complete` on the same connection.
   */
  front(): ReplayWindow | undefined {
    return this.windows[0];
  }

  /** Pops and returns the oldest window — called when its `replay_complete` marker arrives. */
  closeOldest(): ReplayWindow | undefined {
    return this.windows.shift();
  }

  /** Every still-open window, oldest first. */
  openWindows(): ReplayWindow[] {
    return this.windows.filter((w) => w.status === 'open');
  }

  /** Detach / dispose / client rebind: no marker can arrive again on this binding — drain the whole FIFO so every window settles. */
  drain(): ReplayWindow[] {
    const all = [...this.windows];
    this.windows.length = 0;
    return all;
  }

  /**
   * Removes and returns every window NOT tagged with `current` — a
   * reconnect invalidates them (their `resume()` request went out on a
   * connection that is now gone, so their own `replay_complete` can never
   * arrive), while a window already opened on the new connection is left
   * queued untouched. Order among the kept windows is preserved.
   */
  drainStale(current: number): ReplayWindow[] {
    const stale: ReplayWindow[] = [];
    for (let i = this.windows.length - 1; i >= 0; i--) {
      if (this.windows[i]!.connectionGeneration !== current) {
        stale.unshift(...this.windows.splice(i, 1));
      }
    }
    return stale;
  }
}
