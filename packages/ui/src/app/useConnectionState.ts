/**
 * Polls the daemon HTTP /health endpoint and reflects connection state.
 *
 * Auth notes (verified against packages/core/src/server/middleware/auth.ts):
 * - `/health` is explicitly bypass-listed — no auth header needed.
 * - The auth secret is in `~/.mainframe/config.json` → `authSecret` field,
 *   accessible via the `get_auth_token` Tauri command (see bridge.ts).
 *   The secret is used for WebSocket and non-localhost API calls only.
 * - Since Tauri runs on localhost, HTTP API calls are also trusted without
 *   a token (isLocalhost() bypass in the auth middleware).
 */
import { useState, useEffect, useRef } from 'react';
import { getHost } from '../lib/host';
import { getActiveDaemon, setActiveDaemon } from '../lib/daemon/active-daemon';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

const POLL_INTERVAL_MS = 2000;
const HEALTH_TIMEOUT_MS = 3000;

/** Daemon health endpoint. IPv4 loopback — the daemon binds 127.0.0.1 only,
 *  and `localhost` resolves to ::1 first on IPv6 hosts (poll would never succeed). */
export function healthUrl(port: number): string {
  return `http://127.0.0.1:${port}/health`;
}

/** Calls an unauthenticated /health liveness endpoint (any daemon base URL). */
async function checkHealthUrl(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    // The daemon registers /health (not /api/health) and the auth middleware
    // bypasses it, so no token is needed for local or remote.
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res.ok;
  } catch {
    return false;
  }
}

export function useConnectionState(): {
  state: ConnectionState;
  daemonStatus: string;
  port: number | null;
  /**
   * Latched true on the first successful /health and never reset. The data shell
   * gates its mount on this so the initial REST loads (projects/tags/threads)
   * fire only once the daemon HTTP server is actually listening — having the
   * port is not enough, the sidecar opens its port before it accepts requests.
   * Latched (not just `state === 'connected'`) so a transient post-boot blip
   * doesn't tear the mounted shell down.
   */
  ready: boolean;
} {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [daemonStatus, setDaemonStatus] = useState('initializing');
  const [port, setPort] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const portRef = useRef<number | null>(null);
  /** Guards the local target seed — fires setActiveDaemon exactly once. */
  const seededRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout>;

    let unlisten: (() => void) | undefined;

    async function poll() {
      if (cancelled) return;
      const currentPort = portRef.current;
      if (currentPort == null) {
        setState('connecting');
        pollTimer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        return;
      }
      // Before the local target is seeded, probe localhost to establish boot
      // readiness. Once an active daemon exists, probe IT (local OR remote) so
      // the connection state reflects the daemon the app is actually talking to
      // — a failing remote must flip to 'disconnected', not stay green because
      // the local sidecar is still healthy.
      const healthTarget = seededRef.current ? `${getActiveDaemon().baseUrl}/health` : healthUrl(currentPort);
      const healthy = await checkHealthUrl(healthTarget);
      if (cancelled) return;
      setState(healthy ? 'connected' : 'disconnected');
      if (healthy) {
        setReady(true); // one-way latch — never reset to false
        if (!seededRef.current) {
          seededRef.current = true;
          setActiveDaemon({
            id: 'local',
            kind: 'local',
            label: 'Local',
            baseUrl: `http://127.0.0.1:${currentPort}`,
            token: null,
          });
        }
      }
      pollTimer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    }

    // Acquire the daemon port (+ status). A bridge/port reject must NOT pin the
    // app on "connecting" — show disconnected and retry (the sidecar may still
    // be spawning), so a slow or restarting daemon recovers on its own.
    async function acquirePort() {
      try {
        const p = await getHost().daemon.port();
        const s = await getHost().daemon.status();
        if (cancelled) return;
        setPort(p);
        portRef.current = p;
        setDaemonStatus(s);
        void poll();
      } catch (err) {
        if (cancelled) return;
        console.warn('[useConnectionState] daemon port unavailable — retrying', err);
        setState('disconnected');
        setDaemonStatus('unavailable');
        pollTimer = setTimeout(() => void acquirePort(), POLL_INTERVAL_MS);
      }
    }

    async function init() {
      // Register the daemon:status listener once (NOT in the retry loop). A
      // failure here is non-fatal — the poll loop still provides liveness.
      try {
        unlisten = await getHost().daemon.onStatus((status) => setDaemonStatus(status));
      } catch (err) {
        console.warn('[useConnectionState] daemon status listener failed', err);
      }
      if (cancelled) {
        unlisten?.();
        return;
      }
      void acquirePort();
    }

    void init();

    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
      unlisten?.();
    };
  }, []);

  return { state, daemonStatus, port, ready };
}
