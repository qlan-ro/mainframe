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

/** Calls the unauthenticated /health liveness endpoint. */
async function checkHealth(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    // The daemon registers /health (not /api/health). Auth middleware
    // explicitly bypasses this path (middleware/auth.ts line 25).
    const res = await fetch(`http://localhost:${port}/health`, {
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
} {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [daemonStatus, setDaemonStatus] = useState('initializing');
  const [port, setPort] = useState<number | null>(null);
  const portRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout>;

    async function init() {
      // Listen for daemon:status Rust events (emitted from lib.rs on setup).
      const unlisten = await onDaemonStatus((status) => {
        setDaemonStatus(status);
      });

      const p = await getDaemonPort();
      const s = await getDaemonStatus();
      if (cancelled) {
        unlisten();
        return;
      }

      setPort(p);
      portRef.current = p;
      setDaemonStatus(s);

      async function poll() {
        if (cancelled) return;
        const currentPort = portRef.current;
        if (currentPort == null) {
          setState('connecting');
          pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
          return;
        }
        const healthy = await checkHealth(currentPort);
        if (cancelled) return;
        setState(healthy ? 'connected' : 'disconnected');
        pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
      }

      void poll();
      return unlisten;
    }

    let unlisten: (() => void) | undefined;
    void init().then((u) => {
      unlisten = u;
    });

    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
      unlisten?.();
    };
  }, []);

  return { state, daemonStatus, port };
}
