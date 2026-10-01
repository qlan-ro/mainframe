/**
 * Serializes this attachment's full re-replays — the `session/resume` from
 * start that both `_mainframe.dev/resync` (cache eviction) and
 * `_mainframe.dev/transcript_cleared` (server-side wipe) ask for (T40).
 *
 * Two problems, one guard. The daemon pushes a resync when a resume fails, so
 * an unbounded client turns a transcript that fails repeatably into a loop at
 * round-trip speed; and a wipe racing a resync used to run a second replay
 * concurrently with the first. So: one replay at a time, exponential backoff
 * between consecutive failures, and a give-up that stays quiet until some
 * other path resumes successfully (a heartbeat gap or a reactivation).
 *
 * The two triggers differ only in what a busy moment does to them. A resync
 * is dropped — the replay already running re-seeds from scratch, which is all
 * the resync wanted. A wipe is remembered and runs once the in-flight replay
 * settles: it is user-initiated and must win, and however many arrive during
 * one replay, they coalesce into a single follow-up.
 *
 * **Staged replay (D4, plan task U2).** `replay()` now stays pending until
 * the window it opens settles — its own `replay_complete`, or an earlier
 * abort — not just until the resume reply arrives, so "one full replay at a
 * time" now also covers the time the daemon spends streaming it. A resync
 * that arrives while a window is still open but NOT this instance's own
 * in-flight run (e.g. a plain `attach()`'s resume, never routed through
 * here) aborts that foreign window and schedules this instance's own replay
 * through the normal backoff path rather than firing immediately — a replay
 * window is never trusted to still be the "current" one once a second resync
 * says the cache moved again. `ReplayCancelledError` (a detach, dispose,
 * rebind, or a window superseded before its own marker) is a quiet end: no
 * backoff, no warning, just stop.
 *
 * **Backoff resets only on PROVEN success (independent review findings 3,
 * 6).** Whether a completed replay counts as "fixed" is decided by
 * `AcpSessionAttachment.resume()`, not here: this class never resets its own
 * backoff on a successful `replay()` call. A plain resync/wipe still gets
 * its usual immediate reset (via `resume()`, after its window genuinely
 * closes — not merely after the reply, which a window the daemon later
 * aborts would wrongly count as success). A `needs-replay`-triggered run
 * (an unknown-id patch — a create frame `parseOrWarn` dropped, say) carries
 * `trigger: 'needs-replay'` end to end; `resume()` recognizes it and skips
 * the reset even though the window closed fine, because "the replay
 * completed" is not evidence the specific id it was chasing is now known.
 *
 * **`needs-replay` success uses a growing COOLDOWN, never the give-up
 * backoff (re-review finding 2).** A FAILED replay (a rejected resume, or a
 * daemon-aborted marker) still goes through `scheduleRetry()` below exactly
 * like a resync's failure would — real errors keep today's backoff and
 * give-up, for either trigger. But a `needs-replay` run that closes
 * successfully is not a failure, so arming the SAME give-up machinery on its
 * success (the previous fix for finding 6) was itself a bug: seven
 * consecutive unknown-id chunks rearmed the backoff seven times (1, 2, 4,
 * 8, 16, 30, 30s) until `gaveUp` latched — permanently, since `needs-replay`
 * never resets it the way a resync does — silencing every later genuinely
 * missing item for the rest of a healthy session. `armNeedsReplayCooldown()`
 * replaces that: a successful `needs-replay` run starts (or, if one is
 * already running down, doubles) a short cooldown window — 2s to start,
 * capped at 30s — and ANY `needs-replay` request that arrives while it is
 * still ticking is coalesced into a single flag rather than dropped or
 * queued; at most one follow-up replay runs when the cooldown expires. If
 * nothing re-requested during a cooldown, the NEXT one starts back at the
 * 2s base — the growth only tracks an unknown id that keeps recurring right
 * on the heels of each replay, not a cumulative streak. This state is
 * entirely separate from `timer`/`gaveUp`/`delayMs` (which stay resync/wipe/
 * failure-only): `needs-replay` success never sets `gaveUp`, so a transient
 * unknown id resolves with exactly one replay, and a quiet session never
 * goes permanently deaf to a later, unrelated missing item. An explicit
 * `'resync'` still cancels and overrides any running cooldown outright — a
 * daemon-pushed resync outranks a client-side guess about one unknown id.
 * The remembered-bad-ids alternative (suppress `needs-replay` requests for a
 * SPECIFIC id once a replay completes without resolving it) was still not
 * chosen: it needs new cross-layer state (which ids, and when to forget them
 * if the daemon later fixes itself), where the cooldown reuses a single
 * per-trigger timer this class already owns.
 */
import { ReplayCancelledError } from './acp-replay-window';

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const NEEDS_REPLAY_BASE_COOLDOWN_MS = 2_000;
const NEEDS_REPLAY_MAX_COOLDOWN_MS = 30_000;

/** Why a replay is being requested — threaded through to `AcpSessionAttachment.resume()` so it knows whether a successful close is evidence enough to reset the backoff (findings 3, 6). */
export type FullReplayTrigger = 'resync' | 'needs-replay';

export interface FullReplayRetryHost {
  /** True while the FIFO's oldest window is still open (not yet closed or aborted) — a resync must not race it. */
  hasOpenWindow(): boolean;
  /** Marks that open window aborted and settles its `resume()` promise — see `acp-session-attachment.ts`. */
  abortOpenWindow(): void;
}

export class FullReplayRetry {
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private delayMs = 0;
  private gaveUp = false;
  private wipePending = false;
  /** The reason the CURRENT backoff streak started — every automatic retry inherits it until a resync/wipe explicitly restarts the streak. */
  private lastTrigger: FullReplayTrigger = 'resync';
  /** `needs-replay`'s own cooldown timer (re-review finding 2) — entirely separate from `timer`/`gaveUp`/`delayMs` above, which stay resync/wipe/failure-only. */
  private needsReplayCooldownTimer: ReturnType<typeof setTimeout> | null = null;
  /** Current cooldown length; 0 means "not escalated" — the next cooldown armed starts at the base. */
  private needsReplayCooldownMs = 0;
  /** A `needs-replay` request arrived while the cooldown above was still ticking — coalesced into a single follow-up run at expiry. */
  private needsReplayCoalesced = false;

  constructor(
    private readonly replay: (opts: { wipe: boolean; trigger: FullReplayTrigger }) => Promise<void>,
    private readonly chatId: () => string,
    private readonly host: FullReplayRetryHost,
  ) {}

  /**
   * `needs-replay` while its own cooldown is still ticking is coalesced, not
   * dropped and not run immediately (re-review finding 2) — a steadily
   * recurring unknown id gets at most one follow-up replay per cooldown
   * window instead of one per patch. Otherwise: ignored while a replay is in
   * flight, while a (resync/wipe/failure) retry is armed, and after the
   * give-up — UNLESS the armed timer/give-up belongs to a `needs-replay`
   * streak and this call is a genuine `'resync'`: a daemon-pushed resync
   * always outranks a client-side guess about one unknown id, so it cancels
   * that backoff (and any running cooldown) and proceeds now rather than
   * waiting out a delay that was never about this signal. A backoff a REAL
   * resync failure armed is left alone either way (today's "one resync at a
   * time" behavior, unchanged). If a DIFFERENT window is open (not this
   * instance's own in-flight run), that window is stale the moment a new
   * request arrives — abort it and go through the backoff path (resync) or
   * the cooldown (`needs-replay`) instead of firing immediately.
   */
  requestResync(trigger: FullReplayTrigger = 'resync'): void {
    if (this.inFlight) return;
    if (trigger === 'needs-replay' && this.needsReplayCooldownTimer !== null) {
      this.needsReplayCoalesced = true;
      return;
    }
    const resyncOutranksNeedsReplayBackoff = trigger === 'resync' && this.lastTrigger === 'needs-replay';
    if ((this.timer !== null || this.gaveUp) && !resyncOutranksNeedsReplayBackoff) return;
    if (resyncOutranksNeedsReplayBackoff) {
      this.reset();
      this.cancel();
    }
    if (trigger === 'resync') this.cancelNeedsReplayCooldown();
    this.lastTrigger = trigger;
    if (this.host.hasOpenWindow()) {
      this.host.abortOpenWindow();
      if (trigger === 'needs-replay') this.armNeedsReplayCooldown();
      else this.scheduleRetry();
      return;
    }
    void this.run(false, trigger);
  }

  /**
   * Never dropped: a wipe supersedes an armed retry, and waits out an
   * in-flight replay. It also starts a fresh backoff — inheriting a capped
   * delay would leave a user-initiated wipe with no retries at all. A wipe
   * is always a plain `'resync'`-shaped trigger: it is user/server-initiated,
   * never a patch chasing one specific unknown id, so it cancels any running
   * `needs-replay` cooldown too.
   */
  requestWipe(): void {
    this.reset();
    this.cancelNeedsReplayCooldown();
    this.lastTrigger = 'resync';
    if (this.inFlight) {
      this.wipePending = true;
      return;
    }
    this.cancel();
    void this.run(true, 'resync');
  }

  /**
   * Clears the failure streak, including a give-up. Called by
   * `AcpSessionAttachment.resume()` once a window PROVABLY closed
   * successfully — never from inside `run()` itself (findings 3, 6) — so a
   * window the daemon later aborts, or a needs-replay-triggered run, never
   * looks like proof the connection is healthy. An armed retry is
   * deliberately left running when this fires for an unrelated reason (e.g.
   * a gap resume): a gap resume replays from the settled cursor at the tail,
   * which is exactly what a resync (front eviction) says is not enough.
   */
  reset(): void {
    this.delayMs = 0;
    this.gaveUp = false;
  }

  /** Detach/dispose: drop an armed retry (and any running `needs-replay` cooldown) so a dormant attachment stays quiet. */
  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.cancelNeedsReplayCooldown();
  }

  /** Stops a running `needs-replay` cooldown outright and drops anything it had coalesced — an explicit resync/wipe/detach supersedes it. */
  private cancelNeedsReplayCooldown(): void {
    if (this.needsReplayCooldownTimer !== null) {
      clearTimeout(this.needsReplayCooldownTimer);
      this.needsReplayCooldownTimer = null;
    }
    this.needsReplayCoalesced = false;
    this.needsReplayCooldownMs = 0;
  }

  /**
   * Arms (or, if one is already running down, doubles — capped) the
   * `needs-replay` cooldown. At expiry: a coalesced request runs exactly one
   * follow-up replay (which re-arms this same cooldown, doubled, on its own
   * success); a quiet expiry resets the length back to the base so the NEXT
   * fresh `needs-replay` starts over, rather than inheriting a stale streak.
   */
  private armNeedsReplayCooldown(): void {
    this.needsReplayCooldownMs =
      this.needsReplayCooldownMs === 0
        ? NEEDS_REPLAY_BASE_COOLDOWN_MS
        : Math.min(this.needsReplayCooldownMs * 2, NEEDS_REPLAY_MAX_COOLDOWN_MS);
    this.needsReplayCooldownTimer = setTimeout(() => {
      this.needsReplayCooldownTimer = null;
      if (this.needsReplayCoalesced) {
        this.needsReplayCoalesced = false;
        void this.run(false, 'needs-replay');
      } else {
        this.needsReplayCooldownMs = 0;
      }
    }, this.needsReplayCooldownMs);
  }

  private async run(wipe: boolean, trigger: FullReplayTrigger): Promise<void> {
    this.inFlight = true;
    try {
      await this.replay({ wipe, trigger });
      // No `this.reset()` here — see the class doc and `AcpSessionAttachment.resume()`.
      // A needs-replay-triggered run closing fine is not proof the id it was
      // chasing is now known (finding 6) — but it IS proof this run itself
      // succeeded, so it gets the cooldown, never the give-up backoff
      // (re-review finding 2). A plain resync/wipe needs no such caution:
      // `resume()` resets the backoff for it unconditionally.
      if (trigger === 'needs-replay') this.armNeedsReplayCooldown();
    } catch (error) {
      if (error instanceof ReplayCancelledError) {
        // Superseded, not failed — a detach/dispose/rebind or a newer
        // resync already took over. No backoff, no noise.
      } else {
        console.warn('[acp-session] full re-replay failed', error);
        this.scheduleRetry();
      }
    } finally {
      this.inFlight = false;
      this.runPendingWipe();
    }
  }

  private runPendingWipe(): void {
    if (!this.wipePending) return;
    this.wipePending = false;
    this.cancel();
    this.lastTrigger = 'resync';
    void this.run(true, 'resync');
  }

  private scheduleRetry(): void {
    if (this.delayMs >= MAX_DELAY_MS) {
      this.gaveUp = true;
      console.warn(
        `[acp-session] giving up the full re-replay for ${this.chatId()} — a gap or reactivation will retry`,
      );
      return;
    }
    this.delayMs = this.delayMs === 0 ? BASE_DELAY_MS : Math.min(this.delayMs * 2, MAX_DELAY_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run(false, this.lastTrigger);
    }, this.delayMs);
  }
}
