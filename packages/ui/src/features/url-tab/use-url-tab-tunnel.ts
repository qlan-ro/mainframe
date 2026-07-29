/**
 * useUrlTabTunnel — the React binding between a `url` Run tab and the per-port
 * tunnel machinery (#281). All classification is pure and lives in
 * `resolveUrlTabTarget`; this hook only owns the attempt-scoped state that
 * feeds it, the start request, and the ownership registration.
 *
 * Every flag below is per *attempt* — a Retry bumps the counter and resets them
 * wholesale, which is what makes Retry work from `failed` and `stopped` alike.
 * The one exception is ownership, which is per *port*: a tab that was ever seen
 * creating a port's tunnel stays its owner across retries (D10).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { classifyLocalhostUrl } from '@qlan-ro/mainframe-types';
import { startPortTunnel } from '@/lib/api/tunnel-ports';
import {
  usePortTunnelsStore,
  useTunnelDaemonPort,
  clearPortTunnelEntry,
  reportPortTunnelError,
} from '@/store/port-tunnels';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useDaemonIsLocal } from '@/lib/daemon/use-daemon-is-local';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { registerUrlTunnelConsumer } from './tunnel-consumers';
import { resolveUrlTabTarget, URL_TAB_TUNNEL_TIMEOUT_MS, type UrlTabTarget } from './resolve-url-target';

interface AttemptFlags {
  watching: boolean;
  startUrl: string | null;
  everHadEntry: boolean;
  timedOut: boolean;
}

/** A stable identity so the reset is a no-op re-render when nothing has changed. */
const FRESH: AttemptFlags = { watching: false, startUrl: null, everHadEntry: false, timedOut: false };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface UrlTabTunnel {
  target: UrlTabTarget;
  /** The only way out of `failed` and `stopped`; never fires on its own (D14). */
  retry: () => void;
  /** Bumped once when the tunnel's DNS verifies after the tab already loaded. */
  reloadNonce: number;
}

export function useUrlTabTunnel({
  tabId,
  url,
  active,
}: {
  tabId: string;
  url: string;
  /** Gates the tunnel start + ownership claim — a never-activated rehydrated tab must request neither (spec §"rehydrate unmounted and load on first activation"). */
  active: boolean;
}): UrlTabTunnel {
  const isLocal = useDaemonIsLocal();
  const httpPort = useDaemonPort();
  const daemonPort = useTunnelDaemonPort();
  const chatId = useActiveIdentity().chatId;

  // A local daemon or a non-loopback address needs no tunnel at all, so it
  // subscribes to no port and issues no start.
  const port = useMemo(() => (isLocal ? null : (classifyLocalhostUrl(url)?.port ?? null)), [isLocal, url]);
  const entry = usePortTunnelsStore((s) => (port === null ? undefined : s.byPort[port]));

  const [attempt, setAttempt] = useState(0);
  const [flags, setFlags] = useState<AttemptFlags>(FRESH);
  // The port this tab owns, or null. Cleared whenever the tab stops being the
  // live starter of a port — on a retarget away from it (below) and when the
  // store reports the owned tunnel gone (the `stopped`-transition effect
  // below) — so a later return to that same port never re-adopts a tunnel
  // this tab didn't start (D10, AC12; review-fix findings 1+2).
  const [ownedPort, setOwnedPort] = useState<number | null>(null);
  const attemptRef = useRef(0);
  const startedForAttemptRef = useRef<number | null>(null);
  const prevPortRef = useRef(port);

  // Declared first so a Retry's reset lands before the effects that read it.
  useEffect(() => {
    attemptRef.current = attempt;
    startedForAttemptRef.current = null;
    setFlags(FRESH);
    // Retry bumps `attempt` on the same port and must keep the owner (D10);
    // only an actual retarget abandons the claim.
    if (prevPortRef.current !== port) {
      prevPortRef.current = port;
      setOwnedPort(null);
    }
  }, [attempt, port]);

  const target = useMemo(
    () => resolveUrlTabTarget({ url, isLocal, daemonPort, entry, ...flags }),
    [url, isLocal, daemonPort, entry, flags],
  );

  useEffect(() => {
    if (entry !== undefined) setFlags((f) => (f.everHadEntry ? f : { ...f, everHadEntry: true }));
  }, [entry]);

  // Nothing below this point is real until the tab has been activated at least
  // once — a rehydrated-but-unmounted tab must request no tunnel and start no
  // watchdog (spec: URL tabs "rehydrate unmounted and load on first activation").
  const isPending = active && target.kind === 'pending';

  useEffect(() => {
    if (!isPending) return;
    const timer = setTimeout(() => setFlags((f) => ({ ...f, timedOut: true })), URL_TAB_TUNNEL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isPending, attempt]);

  useEffect(() => {
    if (!isPending || port === null || daemonPort === null || !chatId) return;
    if (startedForAttemptRef.current === attempt) return;
    startedForAttemptRef.current = attempt;
    // Observed as the POST goes out, not a gate on sending it: the daemon's
    // registry is the single-flight point, so a start that joins another
    // consumer's in-flight start spawns no second cloudflared — but this tab
    // only owns the tunnel it saw come into existence (AC12).
    if (entry === undefined) setOwnedPort(port);
    setFlags((f) => ({ ...f, watching: true }));

    const at = attempt;
    startPortTunnel(httpPort, { port, chatId })
      .then(({ url: startUrl }) => {
        if (attemptRef.current === at) setFlags((f) => ({ ...f, startUrl }));
      })
      .catch((err: unknown) => {
        // A rejected start created nothing on the daemon to own — revoke the
        // optimistic claim so a later `ready` entry (someone else's tunnel)
        // is never mistaken for this tab's to stop (AC12/D10).
        setOwnedPort((p) => (p === port ? null : p));
        reportPortTunnelError(port, message(err));
      });
  }, [isPending, port, daemonPort, chatId, httpPort, attempt, entry]);

  // The tunnel this tab started can be stopped out from under it (the chat
  // chip's Stop, or the daemon reaping it) or die with a daemon-side `error`
  // entry (cloudflared crash) — either way the daemon holds no live tunnel of
  // this tab's on the port, so a later `ready` entry belongs to whoever
  // restarted it, never to this tab, and the claim is dropped.
  useEffect(() => {
    if ((target.kind === 'stopped' || target.kind === 'failed') && ownedPort === port) setOwnedPort(null);
  }, [target.kind, ownedPort, port]);

  useEffect(() => {
    if (!active || port === null) return;
    registerUrlTunnelConsumer(tabId, { port, started: ownedPort === port, daemonHttpPort: httpPort });
  }, [active, tabId, port, ownedPort, httpPort]);

  const [reloadNonce, setReloadNonce] = useState(0);
  const loadedBeforeDnsRef = useRef(false);
  const dnsVerified = entry?.dnsVerified === true;

  // cloudflared answers with a URL before its edge DNS resolves, so a tab that
  // loaded early is showing a 404 until it reloads — exactly once (D11).
  useEffect(() => {
    if (target.kind !== 'tunnelled') {
      loadedBeforeDnsRef.current = false;
      return;
    }
    if (!dnsVerified) {
      loadedBeforeDnsRef.current = true;
      return;
    }
    if (loadedBeforeDnsRef.current) {
      loadedBeforeDnsRef.current = false;
      setReloadNonce((n) => n + 1);
    }
  }, [target.kind, dnsVerified]);

  const retry = useCallback(() => {
    if (port !== null) clearPortTunnelEntry(port);
    setAttempt((n) => n + 1);
  }, [port]);

  return { target, retry, reloadNonce };
}
