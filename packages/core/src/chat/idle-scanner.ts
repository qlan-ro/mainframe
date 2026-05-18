import { createChildLogger } from '../logger.js';
import type { ActiveChat } from './types.js';

const logger = createChildLogger('chat:idle-scanner');

export const IDLE_THRESHOLD_MS = 2 * 60 * 60 * 1000;
export const IDLE_SCAN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Periodically kills CLI sessions that have been idle longer than the
 * threshold. The chat record and `claudeSessionId` are preserved so the next
 * user message re-spawns via `--resume`.
 */
export class IdleSessionScanner {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly activeChats: Map<string, ActiveChat>,
    private readonly thresholdMs: number = IDLE_THRESHOLD_MS,
    private readonly intervalMs: number = IDLE_SCAN_INTERVAL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.scan();
    }, this.intervalMs);
    if (typeof this.timer === 'object' && this.timer && 'unref' in this.timer) {
      (this.timer as { unref: () => void }).unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async scan(): Promise<void> {
    const now = this.now();
    for (const [chatId, active] of this.activeChats) {
      const session = active.session;
      if (!session?.isSpawned) continue;
      const last = session.lastActivityAt;
      if (typeof last !== 'number') continue;
      const idleMs = now - last;
      if (idleMs <= this.thresholdMs) continue;
      logger.info({ chatId, idleMs }, 'evicting idle claude session');
      try {
        await session.kill();
      } catch (err) {
        logger.warn({ err, chatId }, 'failed to kill idle session');
      }
    }
  }
}
