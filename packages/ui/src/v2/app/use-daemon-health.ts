/**
 * Polls the active daemon's `/health` and reports connection state.
 *
 * The shipped `useConnectionState` can't serve the lab: it resolves its port
 * through `getHost().daemon.port()`, which rejects under the browser's fake host
 * bridge and would pin the switcher at "Offline". The active target is already
 * seeded by `V2Runtime`, so probing its own base URL is both simpler and correct
 * for a remote — a failing remote must read disconnected even while the local
 * sidecar is healthy.
 */
import { useEffect, useState } from 'react';
import { getActiveDaemon } from '@/lib/daemon/active-daemon';
import type { ConnectionState } from '@/app/useConnectionState';

const POLL_INTERVAL_MS = 2000;
const HEALTH_TIMEOUT_MS = 3000;

async function isHealthy(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export function useDaemonHealth(): ConnectionState {
  const [state, setState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      const healthy = await isHealthy(`${getActiveDaemon().baseUrl}/health`);
      if (cancelled) return;
      setState(healthy ? 'connected' : 'disconnected');
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return state;
}
