import { useState, useEffect, useCallback } from 'react';
import { daemonWs } from '../../../../lib/daemon/ws-client';
import { getTunnelStatus, startTunnel, stopTunnel } from '../../../../lib/api/remote-access';
import type { TunnelStatus } from '../../../../lib/api/remote-access';

/**
 * UI states derived from the daemon's tunnel:status events and the initial
 * REST snapshot. "ready" means the tunnel is actually reachable (DNS verified),
 * not just that cloudflared registered the connection.
 */
export type TunnelUiState = 'idle' | 'starting' | 'verifying' | 'ready' | 'unreachable' | 'error';

export interface UseTunnelStatusResult {
  state: TunnelUiState;
  url: string | null;
  errorMsg: string | null;
  loading: boolean;
  togglingAction: 'start' | 'stop' | null;
  running: boolean;
  verified: boolean;
  start: (opts?: { token?: string; url?: string }) => Promise<{ url: string } | null>;
  stop: (opts?: { clearConfig?: boolean }) => Promise<void>;
  retryVerify: () => Promise<void>;
}

/**
 * Maps a REST snapshot to the corresponding UI state.
 * Called on mount (initial seed) and after start()/retryVerify() to converge
 * with daemon state after a possible missed WS broadcast.
 */
function deriveStateFromSnapshot(status: TunnelStatus): { uiState: TunnelUiState; url: string | null } {
  if (!status.running) return { uiState: 'idle', url: null };
  if (status.verified) return { uiState: 'ready', url: status.url };
  if (status.url) return { uiState: 'unreachable', url: status.url };
  return { uiState: 'starting', url: null };
}

/**
 * Subscribes to daemon `tunnel:status` WS events (filtered to the 'daemon'
 * label) and derives a 6-state UI machine from the 5-state daemon protocol.
 * Takes `port` to call the port-first API clients.
 */
export function useTunnelStatus(port: number): UseTunnelStatusResult {
  const [state, setState] = useState<TunnelUiState>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingAction, setTogglingAction] = useState<'start' | 'stop' | null>(null);

  const running = state !== 'idle' && state !== 'error';
  const verified = state === 'ready';

  const refresh = useCallback(async () => {
    try {
      const status = await getTunnelStatus(port);
      const { uiState, url: derivedUrl } = deriveStateFromSnapshot(status);
      setUrl(derivedUrl);
      setState(uiState);
    } catch (err) {
      console.warn('[settings/use-tunnel-status] failed to get tunnel status', err);
    } finally {
      setLoading(false);
    }
  }, [port]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return daemonWs.onEvent((event) => {
      if (typeof event !== 'object' || event === null) return;
      const e = event as Record<string, unknown>;
      if (e['type'] !== 'tunnel:status') return;
      if (e['label'] !== 'daemon') return;
      applyWsEvent(e, setState, setUrl, setErrorMsg);
    });
  }, []);

  const start = useCallback(
    async (opts?: { token?: string; url?: string }): Promise<{ url: string } | null> => {
      setTogglingAction('start');
      try {
        setState('starting');
        setErrorMsg(null);
        const result = await startTunnel(port, opts);
        setUrl(result.url);
        // Refresh after the HTTP call resolves to converge on daemon state in
        // case a WS broadcast was missed while the socket was briefly disconnected.
        await refresh();
        return result;
      } catch (err) {
        console.warn('[settings/use-tunnel-status] tunnel start failed', err);
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setState('error');
        return null;
      } finally {
        setTogglingAction(null);
      }
    },
    [port, refresh],
  );

  const stop = useCallback(
    async (opts?: { clearConfig?: boolean }) => {
      setTogglingAction('stop');
      try {
        await stopTunnel(port, opts);
        setState('idle');
        setUrl(null);
        setErrorMsg(null);
      } catch (err) {
        console.warn('[settings/use-tunnel-status] tunnel stop failed', err);
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setTogglingAction(null);
      }
    },
    [port],
  );

  const retryVerify = useCallback(async () => {
    setState('verifying');
    await refresh();
  }, [refresh]);

  return { state, url, errorMsg, loading, togglingAction, running, verified, start, stop, retryVerify };
}

/** Applies a single WS tunnel:status event payload to the React state setters. */
function applyWsEvent(
  e: Record<string, unknown>,
  setState: (s: TunnelUiState) => void,
  setUrl: (u: string | null) => void,
  setErrorMsg: (m: string | null) => void,
): void {
  switch (e['state']) {
    case 'starting':
      setState('starting');
      setUrl(null);
      setErrorMsg(null);
      break;
    case 'ready':
      setUrl((e['url'] as string | undefined) ?? null);
      setState('verifying');
      setErrorMsg(null);
      break;
    case 'dns_verified':
      setUrl((e['url'] as string | undefined) ?? null);
      setState(e['dnsVerified'] ? 'ready' : 'unreachable');
      break;
    case 'error':
      console.warn('[settings/use-tunnel-status] tunnel error from daemon', e['error']);
      setState('error');
      setErrorMsg((e['error'] as string | undefined) ?? 'Tunnel failed to start');
      setUrl(null);
      break;
    case 'stopped':
      setState('idle');
      setUrl(null);
      setErrorMsg(null);
      break;
    default:
      break;
  }
}
