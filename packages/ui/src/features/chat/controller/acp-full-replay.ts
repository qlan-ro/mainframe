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
 */
import { ReplayCancelledError } from './acp-replay-window';

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

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

  constructor(
    private readonly replay: (opts: { wipe: boolean }) => Promise<void>,
    private readonly chatId: () => string,
    private readonly host: FullReplayRetryHost,
  ) {}

  /**
   * Ignored while a replay is in flight, while a retry is armed, and after
   * the give-up. If a DIFFERENT window is open (not this instance's own
   * in-flight run), that window is stale the moment a new resync arrives —
   * abort it and go through the backoff path instead of firing immediately,
   * so a client that keeps getting re-notified mid-replay doesn't hammer the
   * daemon once per notification.
   */
  requestResync(): void {
    if (this.inFlight || this.timer !== null || this.gaveUp) return;
    if (this.host.hasOpenWindow()) {
      this.host.abortOpenWindow();
      this.scheduleRetry();
      return;
    }
    void this.run(false);
  }

  /**
   * Never dropped: a wipe supersedes an armed retry, and waits out an
   * in-flight replay. It also starts a fresh backoff — inheriting a capped
   * delay would leave a user-initiated wipe with no retries at all.
   */
  requestWipe(): void {
    this.reset();
    if (this.inFlight) {
      this.wipePending = true;
      return;
    }
    this.cancel();
    void this.run(true);
  }

  /**
   * A successful resume from any path clears the failure streak, including a
   * give-up. An armed retry is deliberately left running: a gap resume
   * replays from the settled cursor at the tail, which is exactly what a
   * resync (front eviction) says is not enough.
   */
  reset(): void {
    this.delayMs = 0;
    this.gaveUp = false;
  }

  /** Detach/dispose: drop an armed retry so a dormant attachment stays quiet. */
  cancel(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private async run(wipe: boolean): Promise<void> {
    this.inFlight = true;
    try {
      await this.replay({ wipe });
      this.reset();
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
    void this.run(true);
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
      void this.run(false);
    }, this.delayMs);
  }
}
