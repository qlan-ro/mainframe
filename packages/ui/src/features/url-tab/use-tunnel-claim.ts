/**
 * useTunnelClaim — the React binding for the pure claim reducer in
 * `tunnel-claim.ts` (#281, D10/AC12). It owns the two signals that come from
 * observation rather than from an action: a `rebind` whenever this tab's
 * (daemon, port) pair moves, and the daemon's own view of the port.
 *
 * The port is observed through the store's **writes**, not through the entry as
 * a render value. Two writes inside one React batch — the daemon's `stopped`
 * followed by a foreign consumer's `ready` on the same port — collapse into a
 * single rendered value, and the `absent` that revokes this tab's claim would
 * never be seen; the tab would then stop a tunnel it never started. A
 * subscription sees both, in order, and the reducer folds them the same way it
 * folds two separate ticks.
 *
 * `note` is the raw dispatch on purpose. Every caller stamps the `httpPort`,
 * `port` and `attempt` it is *acting on*, so a promise callback that lands late
 * carries its issue-time identity instead of the current render's — which is
 * what makes a stale attempt's rejection harmless.
 */
import { useEffect, useReducer } from 'react';
import { usePortTunnelsStore, type PortTunnelEntry } from '@/store/port-tunnels';
import { claimOwns, claimReducer, entryDaemonState, type ClaimSignal } from './tunnel-claim';

export interface TunnelClaimBinding {
  /** This tab may stop the tunnel currently on `port`. */
  owns: boolean;
  note: (signal: ClaimSignal) => void;
}

export function useTunnelClaim({ httpPort, port }: { httpPort: number; port: number | null }): TunnelClaimBinding {
  const [claim, note] = useReducer(claimReducer, null);

  useEffect(() => {
    note({ type: 'rebind', httpPort, port });
  }, [httpPort, port]);

  useEffect(() => {
    if (port === null) return;
    const observe = (entry: PortTunnelEntry | undefined): void => {
      note({ type: 'daemon-state', httpPort, port, state: entryDaemonState(entry) });
    };
    observe(usePortTunnelsStore.getState().byPort[port]);
    return usePortTunnelsStore.subscribe((state, prev) => {
      if (state.byPort[port] !== prev.byPort[port]) observe(state.byPort[port]);
    });
  }, [httpPort, port]);

  return { owns: claimOwns(claim, httpPort, port), note };
}
