/**
 * useTunnelClaim — the React binding for the pure claim reducer in
 * `tunnel-claim.ts` (#281, D10/AC12). It owns none of the claim's state: that
 * lives in the module-level `tunnel-claim-registry`, keyed by `tabId`
 * (review-fix findings 1+3), so a session-switch unmount never forgets a
 * claim the way a plain `useReducer(claimReducer, null)` would.
 *
 * `daemon-state` — the signal that can *revoke* a claim — is applied by the
 * registry itself, from its own subscription to the port-tunnels store
 * (review-fix NEW finding). That subscription outlives this component, so a
 * revocation that happens while the tab is unmounted is not missed. This hook
 * is therefore just a **reader** of the registry (`useSyncExternalStore`) plus
 * a dispatcher for the signals that only an acting component can know about:
 * `rebind` (this tab's own port changed) and, via `note`, `start-issued` /
 * `start-rejected` / `local-clear`.
 *
 * `note` is the raw dispatch on purpose. Every caller stamps the `httpPort`,
 * `port` and `attempt` it is *acting on*, so a promise callback that lands late
 * carries its issue-time identity instead of the current render's — which is
 * what makes a stale attempt's rejection harmless.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { claimOwns, type ClaimSignal } from './tunnel-claim';
import { getStoredClaim, noteClaim, subscribeClaim } from './tunnel-claim-registry';

export interface TunnelClaimBinding {
  /** This tab may stop the tunnel currently on `port`. */
  owns: boolean;
  note: (signal: ClaimSignal) => void;
}

export function useTunnelClaim({
  tabId,
  httpPort,
  port,
}: {
  tabId: string;
  httpPort: number;
  port: number | null;
}): TunnelClaimBinding {
  const subscribe = useCallback((onChange: () => void) => subscribeClaim(tabId, onChange), [tabId]);
  const getSnapshot = useCallback(() => getStoredClaim(tabId), [tabId]);
  const claim = useSyncExternalStore(subscribe, getSnapshot);

  const note = useCallback((signal: ClaimSignal) => noteClaim(tabId, signal), [tabId]);

  useEffect(() => {
    note({ type: 'rebind', httpPort, port });
  }, [note, httpPort, port]);

  return { owns: claimOwns(claim, httpPort, port), note };
}
