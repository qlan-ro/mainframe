/**
 * useTunnelClaim — the React binding for the pure claim reducer in
 * `tunnel-claim.ts` (#281, D10/AC12). It owns the two signals that come from
 * render inputs rather than from an action: a `rebind` whenever this tab's
 * (daemon, port) pair moves, and the daemon's own view of the port.
 *
 * `note` is the raw dispatch on purpose. Every caller stamps the `httpPort`,
 * `port` and `attempt` it is *acting on*, so a promise callback that lands late
 * carries its issue-time identity instead of the current render's — which is
 * what makes a stale attempt's rejection harmless.
 */
import { useEffect, useReducer } from 'react';
import type { PortTunnelEntry } from '@/store/port-tunnels';
import { claimOwns, claimReducer, entryDaemonState, type ClaimSignal } from './tunnel-claim';

export interface TunnelClaimBinding {
  /** This tab may stop the tunnel currently on `port`. */
  owns: boolean;
  note: (signal: ClaimSignal) => void;
}

export function useTunnelClaim({
  httpPort,
  port,
  entry,
}: {
  httpPort: number;
  port: number | null;
  entry: PortTunnelEntry | undefined;
}): TunnelClaimBinding {
  const [claim, note] = useReducer(claimReducer, null);

  useEffect(() => {
    note({ type: 'rebind', httpPort, port });
  }, [httpPort, port]);

  useEffect(() => {
    if (port === null) return;
    note({ type: 'daemon-state', httpPort, port, state: entryDaemonState(entry) });
  }, [httpPort, port, entry]);

  return { owns: claimOwns(claim, httpPort, port), note };
}
