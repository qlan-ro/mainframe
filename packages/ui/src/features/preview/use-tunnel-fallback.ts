/**
 * use-tunnel-fallback — 20s watchdog + one-shot toast for a remote-daemon
 * preview whose Cloudflare tunnel URL never arrives.
 *
 * `tunnelFailed` becomes true when the daemon reported a tunnel error OR the
 * watchdog times out. On the transition into `tunnelFailed`, fires exactly
 * one `mfToast.error`; the fired-flag resets once the config leaves
 * `running` so a subsequent run gets its own toast.
 */
import { useEffect, useRef, useState } from 'react';
import type { LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import { mfToast } from '@/lib/toast';

const TUNNEL_TIMEOUT_MS = 20_000;

interface TunnelFallbackArgs {
  isLocal: boolean;
  status: LaunchProcessStatus | null;
  resolvedUrl: string | null;
  tunnelError: string | null;
  config: string | undefined;
  scopeKey: string | undefined;
}

export function useTunnelFallback({
  isLocal,
  status,
  resolvedUrl,
  tunnelError,
  config,
  scopeKey,
}: TunnelFallbackArgs): { tunnelFailed: boolean } {
  const [timedOut, setTimedOut] = useState(false);
  const toastedRef = useRef(false);

  useEffect(() => {
    if (isLocal || status !== 'running' || resolvedUrl != null || tunnelError != null) {
      setTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setTimedOut(true), TUNNEL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isLocal, status, resolvedUrl, tunnelError, config, scopeKey]);

  const remote = !isLocal;
  const tunnelFailed = remote && (tunnelError != null || timedOut);

  useEffect(() => {
    if (status !== 'running') {
      toastedRef.current = false;
      return;
    }
    if (tunnelFailed && !toastedRef.current) {
      toastedRef.current = true;
      mfToast.error(`Preview tunnel unavailable — ${tunnelError ?? 'timed out'}`);
    }
  }, [tunnelFailed, tunnelError, status]);

  return { tunnelFailed };
}
