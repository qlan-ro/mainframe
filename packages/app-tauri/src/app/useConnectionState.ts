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
import { getDaemonPort, getDaemonStatus, onDaemonStatus } from '../lib/tauri/bridge';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

const POLL_INTERVAL_MS = 2000;
const HEALTH_TIMEOUT_MS = 3000;

/** Daemon health endpoint. IPv4 loopback — the daemon binds 127.0.0.1 only,
 *  and `localhost` resolves to ::1 first on IPv6 hosts (poll would never succeed). */
export function healthUrl(port: number): string {
  return `http://127.0.0.1:${port}/health`;
}

/** Calls the unauthenticated /health liveness endpoint. */
async function checkHealth(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    // The daemon registers /health (not /api/health). Auth middleware
    // explicitly bypasses this path (middleware/auth.ts line 25).
    // IPv4 loopback (see healthUrl) — daemon binds 127.0.0.1 only.
    const res = await fetch(healthUrl(port), {
      signal: controller.signal,
    });
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
      const healthy = await checkHealth(currentPort);
      if (cancelled) return;
      setState(healthy ? 'connected' : 'disconnected');
      if (healthy) setReady(true); // one-way latch — never reset to false
      pollTimer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    }

    // Acquire the daemon port (+ status). A bridge/port reject must NOT pin the
    // app on "connecting" — show disconnected and retry (the sidecar may still
    // be spawning), so a slow or restarting daemon recovers on its own.
    async function acquirePort() {
      try {
        const p = await getDaemonPort();
        const s = await getDaemonStatus();
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
        unlisten = await onDaemonStatus((status) => setDaemonStatus(status));
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
