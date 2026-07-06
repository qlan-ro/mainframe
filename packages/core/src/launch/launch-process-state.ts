import type { LaunchProcessStatus } from '@qlan-ro/mainframe-types';

export interface LaunchOutputEntry {
  stream: 'stdout' | 'stderr';
  data: string;
}

/** Cap on buffered output entries kept per config name (see `outputBuffers`). */
const OUTPUT_BUFFER_CAP = 200;

/**
 * Durable per-config status + recent output, kept independent of
 * LaunchManager's `processes` map (a live `ChildProcess` handle deleted as
 * soon as the child exits).
 *
 * Two races this closes:
 *  - A terminal status ('stopped'/'failed') would never be observable via
 *    getStatus/getAllStatuses if they read the `processes` map directly — the
 *    exit handler sets the status AND deletes the map entry in the same tick,
 *    so any read after exit falls through to a 'stopped' default, masking a
 *    real failure.
 *  - A fast subprocess (spawn → stdout → exit, all within one event-loop
 *    tick) can finish before a console pane's live WS delivery is observed;
 *    the output buffer is a durable replay source for that case, independent
 *    of catching the live `launch.output` event at the exact right moment.
 *
 * Both maps are reset (not deleted) on the next `start()` of the same config
 * name, so a fresh run never carries over a previous run's terminal status or
 * output.
 */
export class LaunchProcessState {
  private statuses = new Map<string, LaunchProcessStatus>();
  private outputBuffers = new Map<string, LaunchOutputEntry[]>();

  /** Call at the start of a fresh run — clears any prior run's output/status. */
  reset(name: string): void {
    this.statuses.set(name, 'starting');
    this.outputBuffers.set(name, []);
  }

  setStatus(name: string, status: LaunchProcessStatus): void {
    this.statuses.set(name, status);
  }

  getStatus(name: string): LaunchProcessStatus {
    return this.statuses.get(name) ?? 'stopped';
  }

  getAllStatuses(): Record<string, LaunchProcessStatus> {
    const result: Record<string, LaunchProcessStatus> = {};
    for (const [name, status] of this.statuses) {
      result[name] = status;
    }
    return result;
  }

  bufferOutput(name: string, stream: 'stdout' | 'stderr', data: string): void {
    const buffer = this.outputBuffers.get(name) ?? [];
    buffer.push({ stream, data });
    if (buffer.length > OUTPUT_BUFFER_CAP) buffer.shift();
    this.outputBuffers.set(name, buffer);
  }

  /** Buffered stdout/stderr for a config, oldest first. */
  getOutputBuffer(name: string): LaunchOutputEntry[] {
    return this.outputBuffers.get(name) ?? [];
  }
}
