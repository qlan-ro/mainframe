/**
 * store/port-tunnels.ts — per-port quick tunnels behind the localhost chips
 * (#279). Seeded from GET /api/tunnel/ports and kept fresh by the single
 * `tunnel:status` subscriber installed at the app root.
 *
 * Keyed by port, so every chip for the same port renders the same entry — the
 * shared-port coherence the spec asks for costs nothing here. An absent key
 * means no tunnel. `daemonPort` comes from the same snapshot because the client
 * cannot infer it: a remote daemon is reached through a portless tunnel URL.
 *
 * The `daemon`-labelled tunnel and `preview:*` entries ride the same WS event;
 * they are filtered out by label and stay owned by `use-tunnel-status.ts`.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import type { DaemonEvent, PortTunnelInfo } from '@qlan-ro/mainframe-types';
import { parsePortTunnelLabel } from '@qlan-ro/mainframe-types';
import { daemonWs } from '@/lib/daemon/ws-client';
import { mfToast } from '@/lib/toast';

export interface PortTunnelEntry {
  state: 'starting' | 'ready' | 'error';
  url?: string;
  error?: string;
}

export interface PortTunnelListEntry extends PortTunnelEntry {
  port: number;
}

interface PortTunnelsState {
  byPort: Record<number, PortTunnelEntry>;
  daemonPort: number | null;
  /**
   * Bumped on every live transition. The seed captures it before its fetch and
   * discards a snapshot that a WS event has since overtaken.
   */
  generation: number;
}

export const usePortTunnelsStore = create<PortTunnelsState>(() => ({
  byPort: {},
  daemonPort: null,
  generation: 0,
}));

/** The tunnel entry for a port, or `undefined` when there is none. */
export function usePortTunnel(port: number): PortTunnelEntry | undefined {
  return usePortTunnelsStore((s) => s.byPort[port]);
}

/** Every known tunnel, port-ascending. */
export function usePortTunnelList(): PortTunnelListEntry[] {
  const byPort = usePortTunnelsStore((s) => s.byPort);
  return useMemo(
    () =>
      Object.entries(byPort)
        .map(([port, entry]) => ({ port: Number(port), ...entry }))
        .sort((a, b) => a.port - b.port),
    [byPort],
  );
}

/** The daemon's own port as the daemon reported it, or `null` before the seed lands. */
export function useTunnelDaemonPort(): number | null {
  return usePortTunnelsStore((s) => s.daemonPort);
}

export function portTunnelGeneration(): number {
  return usePortTunnelsStore.getState().generation;
}

function setEntry(port: number, entry: PortTunnelEntry): void {
  usePortTunnelsStore.setState((s) => ({
    byPort: { ...s.byPort, [port]: entry },
    generation: s.generation + 1,
  }));
}

function clearEntry(port: number): void {
  usePortTunnelsStore.setState((s) => {
    if (!(port in s.byPort)) return s;
    const byPort = { ...s.byPort };
    delete byPort[port];
    return { byPort, generation: s.generation + 1 };
  });
}

const TOAST_DEDUPE_MS = 1000;
const lastToastAt = new Map<number, number>();

/**
 * The one place a port tunnel goes to `error` — both the WS `error` state and a
 * rejected start POST come through here, so a failure that arrives on both
 * paths still raises a single toast.
 *
 * A tunnel that is already `ready` is never downgraded: cloudflared re-emits
 * errors for a live tunnel (a transient edge reconnect), and taking a working
 * URL away from the user over one is worse than saying nothing.
 */
export function reportPortTunnelError(port: number, message: string): void {
  if (usePortTunnelsStore.getState().byPort[port]?.state === 'ready') {
    console.warn(`[port-tunnels] ignoring an error for the live tunnel on port ${port}: ${message}`);
    return;
  }

  setEntry(port, { state: 'error', error: message });

  const now = Date.now();
  const last = lastToastAt.get(port);
  if (last !== undefined && now - last < TOAST_DEDUPE_MS) return;
  lastToastAt.set(port, now);
  mfToast.error(`Couldn’t tunnel port ${port}`, { description: message });
}

/** Apply one daemon event. Non-tunnel events and other labels are ignored. */
export function applyPortTunnelEvent(event: DaemonEvent): void {
  if (event.type !== 'tunnel:status') return;
  const port = parsePortTunnelLabel(event.label);
  if (port === null) return;

  switch (event.state) {
    case 'starting':
      setEntry(port, { state: 'starting' });
      break;
    case 'ready':
    case 'dns_verified': {
      const url = event.url ?? usePortTunnelsStore.getState().byPort[port]?.url;
      setEntry(port, url !== undefined ? { state: 'ready', url } : { state: 'ready' });
      break;
    }
    case 'error':
      reportPortTunnelError(port, event.error ?? 'Tunnel failed to start');
      break;
    case 'stopped':
      clearEntry(port);
      break;
  }
}

/** Replace the live entries with a REST snapshot. Does not touch `generation`. */
export function applyPortTunnelSnapshot(tunnels: PortTunnelInfo[]): void {
  const byPort: Record<number, PortTunnelEntry> = {};
  for (const t of tunnels) {
    byPort[t.port] = t.url !== undefined ? { state: t.state, url: t.url } : { state: t.state };
  }
  usePortTunnelsStore.setState({ byPort });
}

export function setTunnelDaemonPort(daemonPort: number): void {
  usePortTunnelsStore.setState({ daemonPort });
}

/** Hard clear — reserved for a genuine daemon SWITCH (disposeDaemonSession). */
export function resetPortTunnels(): void {
  lastToastAt.clear();
  usePortTunnelsStore.setState((s) => ({ byPort: {}, daemonPort: null, generation: s.generation + 1 }));
}

/** Register the single always-on `tunnel:status` subscriber. Mount once at the app root. */
export function installPortTunnelSubscriber(): () => void {
  return daemonWs.onEvent(applyPortTunnelEvent);
}
