/**
 * Module-level tunnel-ownership registry for URL tabs (#281, D10, AC12).
 *
 * Wraps the pure `url-tunnel-ownership` reducers with the one side effect
 * releasing an owner actually needs: stopping the tunnel on the daemon.
 */
import { stopPortTunnel } from '@/lib/api/tunnel-ports';
import { clearStoredClaims, dropStoredClaims } from './tunnel-claim-registry';
import {
  addConsumer,
  clearConsumers,
  emptyConsumerState,
  releaseConsumers,
  type ConsumerRecord,
} from './url-tunnel-ownership';

let state = emptyConsumerState;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stopTunnels(stop: Array<{ port: number; daemonHttpPort: number }>): void {
  for (const { port, daemonHttpPort } of stop) {
    stopPortTunnel(daemonHttpPort, port).catch((err: unknown) => {
      console.warn(`[url-tab] failed to stop the tunnel on port ${port}`, message(err));
    });
  }
}

/**
 * Register (or re-register) a URL tab's claim on a tunnelled port. Idempotent
 * per tab id. Retargeting to a different port releases the old one first
 * (stopping it if this tab owned it and no other consumer remains).
 */
export function registerUrlTunnelConsumer(tabId: string, rec: ConsumerRecord): void {
  const { next, stop } = addConsumer(state, tabId, rec);
  state = next;
  stopTunnels(stop);
}

/** Release the given tabs' claims, stopping any port whose last owner just left. */
export function releaseUrlTunnelConsumers(tabIds: string[]): void {
  const { next, stop } = releaseConsumers(state, tabIds);
  state = next;
  dropStoredClaims(tabIds);
  stopTunnels(stop);
}

/** Daemon-switch cleanup: drop the registry without stopping anything (wrong-daemon risk). */
export function clearUrlTunnelConsumers(): void {
  state = clearConsumers(state);
  clearStoredClaims();
}
