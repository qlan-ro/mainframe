/**
 * tunnel-claim — when a URL tab may stop the port tunnel it is looking at
 * (#281, D10/AC12).
 *
 * A **claim** is this tab's evidence that the daemon currently holds a tunnel,
 * on this daemon, on this port, that this tab caused to exist. It is the only
 * input to `started` in the consumer registry, and `started` is the only thing
 * that lets a release stop a tunnel — so a claim that outlives its evidence
 * kills someone else's tunnel, and one that dies too early leaks cloudflared.
 *
 * Creation evidence is a client inference: `POST /api/tunnel/ports/start`
 * answers identically whether it created the tunnel or joined one, so "this tab
 * created it" means the store held no entry for the port as the POST went out.
 *
 * Three facts a reader must not undo:
 *
 * 1. **The signal union carries no timeout member.** The 120 s watchdog is a
 *    client timer the spec calls non-terminal (D11), and AC9 requires a tunnel
 *    that arrives late to still load — so it says nothing about what the daemon
 *    holds and must never revoke a claim. The fix is the absent case.
 * 2. **`start-rejected` is attempt-scoped.** A hung attempt's POST can reject
 *    long after a later attempt succeeded; only its own attempt's claim dies.
 * 3. **A client-written error entry is `'unknown'`, not `'error'`.** Three
 *    producers write `error` entries and only `applyPortTunnelEvent` speaks for
 *    the daemon; a chip's rejected start POST on this port must not revoke a
 *    live claim (`errorOrigin`, `store/port-tunnels.ts`).
 *
 * Pure and React-free: `PortTunnelEntry` arrives as a type only, so a node-env
 * test can import this module without dragging zustand or the WS client in.
 */
import type { PortTunnelEntry } from '../../store/port-tunnels';

/** What the store's entry for a port says about the daemon — `'unknown'` when it says nothing. */
export type DaemonPortState = 'absent' | 'starting' | 'ready' | 'error' | 'unknown';

export interface TunnelClaim {
  httpPort: number;
  port: number;
  /** The start attempt that last renewed this claim; a rejection from an older one is stale. */
  attempt: number;
  /** The daemon has been observed holding a tunnel on the port since this claim was made. */
  sawEntry: boolean;
}

export type ClaimSignal =
  | { type: 'rebind'; httpPort: number; port: number | null }
  | { type: 'start-issued'; httpPort: number; port: number; attempt: number; entryExisted: boolean }
  | { type: 'start-rejected'; httpPort: number; port: number; attempt: number }
  | { type: 'daemon-state'; httpPort: number; port: number; state: DaemonPortState }
  | { type: 'local-clear'; httpPort: number; port: number };

export function entryDaemonState(entry: PortTunnelEntry | undefined): DaemonPortState {
  if (entry === undefined) return 'absent';
  if (entry.state !== 'error') return entry.state;
  return entry.errorOrigin === 'client' ? 'unknown' : 'error';
}

function owns(claim: TunnelClaim | null, httpPort: number, port: number | null): claim is TunnelClaim {
  return claim !== null && claim.httpPort === httpPort && claim.port === port;
}

/** Keeps the reference when nothing moved, so an idempotent signal re-renders nothing. */
function update(claim: TunnelClaim, changes: Partial<Pick<TunnelClaim, 'attempt' | 'sawEntry'>>): TunnelClaim {
  const next = { ...claim, ...changes };
  return next.attempt === claim.attempt && next.sawEntry === claim.sawEntry ? claim : next;
}

export function claimReducer(claim: TunnelClaim | null, signal: ClaimSignal): TunnelClaim | null {
  switch (signal.type) {
    case 'rebind':
      return owns(claim, signal.httpPort, signal.port) ? claim : null;

    case 'start-issued': {
      // An owner survives Retry (D10); `sawEntry` re-states what the store showed
      // as this attempt's POST went out.
      if (owns(claim, signal.httpPort, signal.port)) {
        return update(claim, { attempt: signal.attempt, sawEntry: signal.entryExisted });
      }
      // A claim naming another port or daemon is stale — drop it rather than
      // move it, so ownership is never transferred by a signal that only
      // reports a start.
      if (claim !== null) return null;
      return signal.entryExisted
        ? null
        : { httpPort: signal.httpPort, port: signal.port, attempt: signal.attempt, sawEntry: false };
    }

    case 'start-rejected':
      if (!owns(claim, signal.httpPort, signal.port)) return claim;
      return claim.attempt === signal.attempt ? null : claim;

    case 'daemon-state': {
      if (!owns(claim, signal.httpPort, signal.port)) return claim;
      switch (signal.state) {
        case 'starting':
        case 'ready':
          return update(claim, { sawEntry: true });
        case 'error':
          return null;
        case 'absent':
          // Absent before any entry means the start is still in flight, not gone.
          return claim.sawEntry ? null : claim;
        case 'unknown':
          return claim;
      }
    }

    case 'local-clear':
      // Retry cleared the entry locally; the daemon was told nothing, so the
      // claim stands but has no observation behind it any more.
      return owns(claim, signal.httpPort, signal.port) ? update(claim, { sawEntry: false }) : claim;
  }
}

export function claimOwns(claim: TunnelClaim | null, httpPort: number, port: number | null): boolean {
  return owns(claim, httpPort, port);
}
