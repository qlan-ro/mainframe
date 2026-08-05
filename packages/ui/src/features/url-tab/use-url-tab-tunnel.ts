/**
 * useUrlTabTunnel — the React binding between a `url` workspace tab and the per-port
 * tunnel machinery (#281). It composes three pieces and owns none of them:
 *
 * - `tunnel-claim.ts` (via `useTunnelClaim`) decides whether this tab may stop
 *   the tunnel it is looking at (D10/AC12);
 * - `use-tunnel-attempt.ts` runs the attempt lifecycle — the start POST, the
 *   flags, the watchdog, Retry — and reports the two signals that move a claim;
 * - `resolve-url-target.ts` classifies what to render, purely.
 *
 * What is left here is the tab's inputs, the composition order, and the
 * ownership registration.
 */
import { useEffect, useMemo } from 'react';
import { classifyLocalhostUrl } from '@qlan-ro/mainframe-types';
import { usePortTunnelsStore, useTunnelDaemonPort } from '@/store/port-tunnels';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useDaemonIsLocal } from '@/lib/daemon/use-daemon-is-local';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { registerUrlTunnelConsumer, releaseUrlTunnelConsumers } from './tunnel-consumers';
import { useTunnelClaim } from './use-tunnel-claim';
import { useTunnelAttempt } from './use-tunnel-attempt';
import { useDnsReload } from './use-dns-reload';
import type { UrlTabTarget } from './resolve-url-target';

export interface UrlTabTunnel {
  target: UrlTabTarget;
  /** The only way out of `failed` and `stopped`; never fires on its own (D14). */
  retry: () => void;
  /** Bumped once when the tunnel's DNS verifies after the tab already loaded. */
  reloadNonce: number;
}

export interface UrlTabTunnelArgs {
  tabId: string;
  url: string;
  /** Gates the tunnel start + ownership claim — a never-activated rehydrated tab must request neither (spec §"rehydrate unmounted and load on first activation"). */
  active: boolean;
}

export function useUrlTabTunnel({ tabId, url, active }: UrlTabTunnelArgs): UrlTabTunnel {
  const isLocal = useDaemonIsLocal();
  const httpPort = useDaemonPort();
  const daemonPort = useTunnelDaemonPort();
  const chatId = useActiveIdentity().chatId;

  // A local daemon or a non-loopback address needs no tunnel at all, so it
  // subscribes to no port and issues no start.
  const port = useMemo(() => (isLocal ? null : (classifyLocalhostUrl(url)?.port ?? null)), [isLocal, url]);
  const entry = usePortTunnelsStore((s) => (port === null ? undefined : s.byPort[port]));

  // Declared before the attempt so its `rebind` and `daemon-state` effects are
  // registered — and so run — ahead of the same commit's `start-issued`.
  const { owns, note } = useTunnelClaim({ tabId, httpPort, port });
  const { target, retry } = useTunnelAttempt({
    url,
    isLocal,
    daemonPort,
    httpPort,
    chatId,
    port,
    entry,
    active,
    note,
  });
  const reloadNonce = useDnsReload({ targetKind: target.kind, dnsVerified: entry?.dnsVerified === true });

  // Registration reads the claim against *this* render's port: on the render
  // where `port` flips, the claim still names the old one, so `started` is
  // false until the new port is claimed on its own evidence.
  useEffect(() => {
    if (!active) return;
    // A retarget onto an address that needs no tunnel leaves the old port with
    // no consumer at all — releasing is what stops it (AC12).
    if (port === null) {
      releaseUrlTunnelConsumers([tabId]);
      return;
    }
    registerUrlTunnelConsumer(tabId, { port, started: owns, daemonHttpPort: httpPort });
  }, [active, tabId, port, owns, httpPort]);

  return { target, retry, reloadNonce };
}
