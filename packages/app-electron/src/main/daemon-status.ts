import { DaemonStatusSchema, type DaemonStatus } from '@qlan-ro/mainframe-types';
import { createMainLogger } from './logger.js';

const log = createMainLogger('electron:daemon-status');

/**
 * Tracks the daemon lifecycle and fans status changes out to subscribers
 * (the IPC bridge wires one subscriber that sends 'daemon:status' to the
 * renderer). The port is fixed at construction (Electron owns 31415).
 */
export class DaemonStatusTracker {
  private status: DaemonStatus = 'initializing';
  private readonly listeners = new Set<(s: DaemonStatus) => void>();

  constructor(private readonly daemonPort: number) {}

  port(): number {
    return this.daemonPort;
  }

  get(): DaemonStatus {
    return this.status;
  }

  set(next: DaemonStatus): void {
    const validated = DaemonStatusSchema.parse(next);
    this.status = validated;
    log.info({ status: validated }, 'daemon status changed');
    for (const cb of this.listeners) cb(validated);
  }

  subscribe(cb: (s: DaemonStatus) => void): () => void {
    this.listeners.add(cb);
    cb(this.status); // replay current
    return () => {
      this.listeners.delete(cb);
    };
  }
}
