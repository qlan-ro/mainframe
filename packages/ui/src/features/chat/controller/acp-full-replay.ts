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
 */
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export class FullReplayRetry {
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private delayMs = 0;
  private gaveUp = false;
  private wipePending = false;

  constructor(
    private readonly replay: () => Promise<void>,
    private readonly chatId: () => string,
  ) {}

  /** Ignored while a replay is in flight, while a retry is armed, and after the give-up. */
  requestResync(): void {
    if (this.inFlight || this.timer !== null || this.gaveUp) return;
    void this.run();
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
    void this.run();
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

  private async run(): Promise<void> {
    this.inFlight = true;
    try {
      await this.replay();
      this.reset();
    } catch (error) {
      console.warn('[acp-session] full re-replay failed', error);
      this.scheduleRetry();
    } finally {
      this.inFlight = false;
      this.runPendingWipe();
    }
  }

  private runPendingWipe(): void {
    if (!this.wipePending) return;
    this.wipePending = false;
    this.cancel();
    void this.run();
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
      void this.run();
    }, this.delayMs);
  }
}
