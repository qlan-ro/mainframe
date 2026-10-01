/**
 * The deferred `run.stopped` stop signal (D7, finding 10) — split out of
 * `acp-session-plane.ts` to keep that file under the 300-line cap once D4
 * staging landed there.
 *
 * A content frame and the idle `state_update` behind it can land in the same
 * throttle flush as two separate WebSocket tasks, so an immediate
 * `run.stopped` can race the new text part's own mount and pop it before it
 * has a chance to stream (Fable test 7). `scheduleStop()` waits
 * `RUN_STOP_SETTLE_MS` before dispatching, giving that race a window to
 * resolve in the right order; `cancel()` is called before forwarding ANY
 * `run.started`, from any source (the facade's own `running`, the
 * optimistic dispatch on send, or a side-band backstop).
 */
import type { ChatStateEvent } from './chat-thread-state';

const RUN_STOP_SETTLE_MS = 50;

export interface RunStopSettleHost {
  dispatch(event: ChatStateEvent): void;
}

export class RunStopSettle {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly host: RunStopSettleHost) {}

  /** Cancels an armed stop, if any — idempotent. */
  cancel(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  /** Arms (replacing any existing) a deferred `run.stopped`. */
  scheduleStop(): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.host.dispatch({ type: 'run.stopped' });
    }, RUN_STOP_SETTLE_MS);
  }
}
