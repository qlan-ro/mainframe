/**
 * Client half of the heartbeat + refetch-on-gap sync contract (todo #350,
 * plan task 19; daemon half: `mainframe-acp::capabilities::heartbeat_notification`).
 * Two independent triggers call `onGap`: a `sequence` jump greater than one
 * (a dropped frame), or silence past `intervalMs * SILENCE_MULTIPLIER` (a
 * stalled connection the socket hasn't reported closed yet).
 */
const SILENCE_MULTIPLIER = 2;

export class HeartbeatWatchdog {
  private lastSequence: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly intervalMs: number,
    private readonly onGap: () => void,
  ) {}

  /** Call once per received `_mainframe.dev/heartbeat`. */
  observe(sequence: number): void {
    if (this.lastSequence !== null && sequence - this.lastSequence > 1) this.onGap();
    this.lastSequence = sequence;
    this.rearm();
  }

  /** Arms the silence timer without requiring a heartbeat to have arrived yet. */
  arm(): void {
    this.rearm();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private rearm(): void {
    this.stop();
    this.timer = setTimeout(() => this.onGap(), this.intervalMs * SILENCE_MULTIPLIER);
  }
}
