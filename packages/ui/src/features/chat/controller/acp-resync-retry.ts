/**
 * Bounded retry for `_mainframe.dev/resync`-triggered re-replays (T40).
 *
 * The daemon pushes a resync when a resume fails, so an unthrottled client
 * turns a transcript that fails repeatably into a loop at round-trip speed:
 * resync → reattach → failure → resync. Three bounds break it — one attempt
 * at a time, exponential backoff between consecutive failures, and a give-up
 * that stays quiet until some other path resumes successfully (a heartbeat
 * gap or a reactivation), which is what `reset()` marks.
 */
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export class ResyncRetry {
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private delayMs = 0;
  private gaveUp = false;

  constructor(
    private readonly attempt: () => Promise<void>,
    private readonly chatId: () => string,
  ) {}

  /** Run the attempt — ignored while one is in flight, while a retry is armed, and after the give-up. */
  request(): void {
    if (this.inFlight || this.timer !== null || this.gaveUp) return;
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
      await this.attempt();
      this.reset();
    } catch (error) {
      console.warn('[acp-session] reattach after resync failed', error);
      this.scheduleRetry();
    } finally {
      this.inFlight = false;
    }
  }

  private scheduleRetry(): void {
    if (this.delayMs >= MAX_DELAY_MS) {
      this.gaveUp = true;
      console.warn(`[acp-session] giving up resync re-replay for ${this.chatId()} — a gap or reactivation will retry`);
      return;
    }
    this.delayMs = this.delayMs === 0 ? BASE_DELAY_MS : Math.min(this.delayMs * 2, MAX_DELAY_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, this.delayMs);
  }
}
