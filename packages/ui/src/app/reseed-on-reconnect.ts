import type { DaemonWsClient } from '../lib/daemon/ws-client';

/**
 * Run `reseed` when the side-band socket comes back after being down.
 *
 * The seeds (adapters, quota, CLI status, port tunnels) were fetched over HTTP when the
 * shell mounted, and the shell only mounts once the daemon answers `/health`. The first
 * socket open that follows is the boot connect, not a recovery: nothing has moved, and
 * reseeding then repeated every one of those requests a few milliseconds after the first
 * (`/api/adapters` was asked for twice). Only an open that follows an observed drop can
 * have missed a daemon restart, so only that one reseeds.
 */
export function reseedOnReconnect(
  ws: Pick<DaemonWsClient, 'subscribeConnection' | 'connected'>,
  reseed: () => void,
): () => void {
  let wasDown = false;
  return ws.subscribeConnection(() => {
    if (!ws.connected) {
      wasDown = true;
      return;
    }
    if (!wasDown) return;
    wasDown = false;
    reseed();
  });
}
