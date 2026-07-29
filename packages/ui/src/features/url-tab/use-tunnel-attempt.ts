/**
 * useTunnelAttempt — the per-attempt lifecycle of a URL tab's tunnel (#281):
 * the attempt counter, the flags that feed `resolveUrlTabTarget`, the 120 s
 * watchdog, the start POST, and Retry.
 *
 * Every flag here is per *attempt* — a Retry bumps the counter and resets them
 * wholesale, which is what makes Retry work from `failed` and `stopped` alike.
 * Ownership is NOT here: it is per claim, lives in `tunnel-claim.ts`, and this
 * hook only reports the two things that move it (a start going out, and that
 * start being refused). `flags.everHadEntry` looks like `claim.sawEntry` and is
 * not: it is per attempt and drives the `stopped` body (D14), while `sawEntry`
 * is per claim and survives Retry.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { startPortTunnel } from '@/lib/api/tunnel-ports';
import { clearPortTunnelEntry, reportPortTunnelError, type PortTunnelEntry } from '@/store/port-tunnels';
import { resolveUrlTabTarget, URL_TAB_TUNNEL_TIMEOUT_MS, type UrlTabTarget } from './resolve-url-target';
import type { ClaimSignal } from './tunnel-claim';

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

export interface TunnelAttempt {
  target: UrlTabTarget;
  /** The only way out of `failed` and `stopped`; never fires on its own (D14). */
  retry: () => void;
}

export interface TunnelAttemptArgs {
  url: string;
  isLocal: boolean;
  daemonPort: number | null;
  httpPort: number;
  chatId: string | undefined;
  port: number | null;
  entry: PortTunnelEntry | undefined;
  /** A never-activated rehydrated tab must start no tunnel and no watchdog. */
  active: boolean;
  note: (signal: ClaimSignal) => void;
}

export function useTunnelAttempt(args: TunnelAttemptArgs): TunnelAttempt {
  const { url, isLocal, daemonPort, httpPort, chatId, port, entry, active, note } = args;
  const [attempt, setAttempt] = useState(0);
  const [flags, setFlags] = useState<AttemptFlags>(FRESH);

  // Declared first so a Retry's or a retarget's reset lands before the effects
  // that read the flags.
  useEffect(() => {
    setFlags(FRESH);
  }, [attempt, port]);

  const target = useMemo(
    () => resolveUrlTabTarget({ url, isLocal, daemonPort, entry, ...flags }),
    [url, isLocal, daemonPort, entry, flags],
  );

  useEffect(() => {
    if (entry !== undefined) setFlags((f) => (f.everHadEntry ? f : { ...f, everHadEntry: true }));
  }, [entry]);

  const isPending = active && target.kind === 'pending';

  useEffect(() => {
    if (!isPending) return;
    const timer = setTimeout(() => setFlags((f) => ({ ...f, timedOut: true })), URL_TAB_TUNNEL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isPending, attempt]);

  const onIssued = useCallback(() => setFlags((f) => (f.watching ? f : { ...f, watching: true })), []);
  const onStartUrl = useCallback((startUrl: string) => setFlags((f) => ({ ...f, startUrl })), []);

  useStartRequest({
    enabled: isPending,
    port,
    httpPort,
    daemonPort,
    chatId,
    entry,
    attempt,
    note,
    onIssued,
    onStartUrl,
  });

  const retry = useCallback(() => {
    // Only a clear that actually happened is a local reset: `clearPortTunnelEntry`
    // no-ops on a `ready` entry, and claiming otherwise would zero the claim's
    // observation while the daemon still holds the tunnel.
    if (port !== null && clearPortTunnelEntry(port)) note({ type: 'local-clear', httpPort, port });
    setAttempt((n) => n + 1);
  }, [port, httpPort, note]);

  return { target, retry };
}

interface StartRequestArgs {
  enabled: boolean;
  port: number | null;
  httpPort: number;
  daemonPort: number | null;
  chatId: string | undefined;
  entry: PortTunnelEntry | undefined;
  attempt: number;
  note: (signal: ClaimSignal) => void;
  onIssued: () => void;
  onStartUrl: (startUrl: string) => void;
}

/**
 * The start POST for the current attempt, issued at most once per (port,
 * attempt) pair. Nothing but values and callbacks crosses this seam: a
 * resolution or rejection that lands after its attempt is gone reaches the
 * caller through neither, so ownership cannot leak back in through a stale ref.
 */
function useStartRequest(args: StartRequestArgs): void {
  const { enabled, port, httpPort, daemonPort, chatId, entry, attempt, note, onIssued, onStartUrl } = args;
  const issuedRef = useRef<{ port: number; attempt: number } | null>(null);
  const liveRef = useRef({ port, attempt });

  useEffect(() => {
    liveRef.current = { port, attempt };
  }, [port, attempt]);

  useEffect(() => {
    if (!enabled || port === null || daemonPort === null || !chatId) return;
    const issued = issuedRef.current;
    if (issued !== null && issued.port === port && issued.attempt === attempt) return;
    issuedRef.current = { port, attempt };

    // Observed as the POST goes out, not a gate on sending it: the daemon's
    // registry is the single-flight point, so a start that joins another
    // consumer's in-flight start spawns no second cloudflared — but this tab
    // only owns the tunnel it saw come into existence (AC12).
    note({ type: 'start-issued', httpPort, port, attempt, entryExisted: entry !== undefined });
    onIssued();

    const isLive = (): boolean => liveRef.current.port === port && liveRef.current.attempt === attempt;
    startPortTunnel(httpPort, { port, chatId })
      .then(({ url: startUrl }) => {
        if (isLive()) onStartUrl(startUrl);
      })
      .catch((err: unknown) => {
        // A superseded attempt says nothing about the live one: its rejection
        // must neither revoke the current claim nor overwrite the store entry
        // the live attempt is driving.
        if (!isLive()) return;
        note({ type: 'start-rejected', httpPort, port, attempt });
        reportPortTunnelError(port, message(err), 'client');
      });
  }, [enabled, port, daemonPort, chatId, httpPort, attempt, entry, note, onIssued, onStartUrl]);
}
