import { createChildLogger } from '../logger.js';

const log = createChildLogger('quota:claude-scheduler');

/** Claude's "always fresh" cadence (#252): pull `/usage` about every five minutes. */
const CLAUDE_PULL_INTERVAL_MS = 5 * 60 * 1000;

export interface ClaudeQuotaSchedulerDeps {
  /** Refresh the Claude quota (delegates to the QuotaManager puller). */
  refresh: () => Promise<unknown>;
  /** Focus proxy: no explicit focus signal exists, so a connected client stands in for it. */
  hasClients: () => boolean;
  intervalMs?: number;
}

/**
 * Drives Claude's active quota cadence. One unconditional warm-up pull on start (the daemon
 * boots with the app, so the first glance reads fresh numbers), then a focus-gated interval:
 * timer ticks only pull when a client is connected, so a backgrounded app spends no /usage runs.
 */
export class ClaudeQuotaScheduler {
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly deps: ClaudeQuotaSchedulerDeps) {}

  start(): void {
    void this.runPull('startup');
    this.timer = setInterval(() => this.tick(), this.deps.intervalMs ?? CLAUDE_PULL_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private tick(): void {
    if (!this.deps.hasClients()) {
      log.debug('quota: skipping timer pull — no connected clients');
      return;
    }
    void this.runPull('timer');
  }

  private async runPull(reason: string): Promise<void> {
    try {
      await this.deps.refresh();
    } catch (err) {
      log.warn({ err, reason }, 'claude quota pull failed');
    }
  }
}
