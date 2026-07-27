import { listPortTunnels } from '@/lib/api/tunnel-ports';
import { applyPortTunnelSnapshot, portTunnelGeneration, setTunnelDaemonPort } from './port-tunnels';

let seedGeneration = 0;

/**
 * Seed the port tunnels after a (re)connect or switch, so a reload finds the
 * tunnels the daemon still holds. A newer call supersedes an in-flight fetch
 * via `seedGeneration`; a WS transition that lands mid-fetch wins over the
 * snapshot via the store's own generation, which is what keeps a slow REST
 * response from resurrecting a tunnel the user just stopped.
 */
export function seedPortTunnels(port: number): void {
  const seedGen = ++seedGeneration;
  const wsGen = portTunnelGeneration();

  listPortTunnels(port)
    .then((list) => {
      if (seedGen !== seedGeneration) return;
      // `daemonPort` is snapshot-only — no WS event carries it, so a stale
      // snapshot is still the best value available for it.
      setTunnelDaemonPort(list.daemonPort);
      if (portTunnelGeneration() !== wsGen) return;
      applyPortTunnelSnapshot(list.tunnels);
    })
    .catch((err: unknown) => console.warn('[port-tunnels] seed failed', err));
}
