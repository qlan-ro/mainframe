/**
 * store/port-tunnels — the WS→state mapping, the error choke point, and the
 * seed's generation guard (#279, plan decisions 5 and 11).
 *
 * Everything here drives the free functions and reads `byPort` directly: the
 * selectors are one-line zustand reads, and the chip test covers the rendered
 * path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DaemonEvent, PortTunnelsList } from '@qlan-ro/mainframe-types';

const toastError = vi.fn();
vi.mock('@/lib/toast', () => ({ mfToast: { error: (...a: unknown[]) => toastError(...a) } }));

// The store installs a subscriber against this module at import time.
const onEvent = vi.fn<(listener: (event: DaemonEvent) => void) => () => void>(() => () => {});
vi.mock('@/lib/daemon/ws-client', () => ({
  daemonWs: { onEvent: (listener: (event: DaemonEvent) => void) => onEvent(listener) },
}));

const listPortTunnels = vi.fn<(port: number) => Promise<PortTunnelsList>>();
vi.mock('@/lib/api/tunnel-ports', () => ({ listPortTunnels: (port: number) => listPortTunnels(port) }));

import {
  applyPortTunnelEvent,
  applyPortTunnelSnapshot,
  clearPortTunnelEntry,
  installPortTunnelSubscriber,
  portTunnelGeneration,
  reportPortTunnelError,
  resetPortTunnels,
  setTunnelDaemonPort,
  usePortTunnelsStore,
} from '../port-tunnels';
import { seedPortTunnels } from '../port-tunnels-seed';

function entries() {
  return usePortTunnelsStore.getState().byPort;
}

function tunnelEvent(event: Omit<Extract<DaemonEvent, { type: 'tunnel:status' }>, 'type'>): DaemonEvent {
  return { type: 'tunnel:status', ...event };
}

beforeEach(() => {
  resetPortTunnels();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('applyPortTunnelEvent — state mapping', () => {
  it('records a starting tunnel with no url', () => {
    applyPortTunnelEvent(tunnelEvent({ state: 'starting', label: 'port:5173' }));
    expect(entries()).toEqual({ 5173: { state: 'starting' } });
  });

  it('records a ready tunnel with its url', () => {
    applyPortTunnelEvent(tunnelEvent({ state: 'ready', label: 'port:5173', url: 'https://a.trycloudflare.com' }));
    expect(entries()).toEqual({ 5173: { state: 'ready', url: 'https://a.trycloudflare.com', dnsVerified: false } });
  });

  it('treats dns_verified as ready', () => {
    applyPortTunnelEvent(
      tunnelEvent({ state: 'dns_verified', label: 'port:5173', url: 'https://a.trycloudflare.com', dnsVerified: true }),
    );
    expect(entries()).toEqual({ 5173: { state: 'ready', url: 'https://a.trycloudflare.com', dnsVerified: true } });
  });

  it('keeps the known url when a dns_verified event carries none', () => {
    applyPortTunnelEvent(tunnelEvent({ state: 'ready', label: 'port:5173', url: 'https://a.trycloudflare.com' }));
    applyPortTunnelEvent(tunnelEvent({ state: 'dns_verified', label: 'port:5173' }));
    expect(entries()).toEqual({ 5173: { state: 'ready', url: 'https://a.trycloudflare.com', dnsVerified: true } });
  });

  it('records an error with the daemon’s message', () => {
    applyPortTunnelEvent(tunnelEvent({ state: 'error', label: 'port:5173', error: 'cloudflared exited' }));
    expect(entries()).toEqual({ 5173: { state: 'error', error: 'cloudflared exited' } });
  });

  it('falls back to a generic message for an error with no detail', () => {
    applyPortTunnelEvent(tunnelEvent({ state: 'error', label: 'port:5173' }));
    expect(entries()).toEqual({ 5173: { state: 'error', error: 'Tunnel failed to start' } });
  });

  it('removes the entry on stopped', () => {
    applyPortTunnelEvent(tunnelEvent({ state: 'ready', label: 'port:5173', url: 'https://a.trycloudflare.com' }));
    applyPortTunnelEvent(tunnelEvent({ state: 'stopped', label: 'port:5173' }));
    expect(entries()).toEqual({});
  });

  it('keeps one entry per port across ports', () => {
    applyPortTunnelEvent(tunnelEvent({ state: 'starting', label: 'port:5173' }));
    applyPortTunnelEvent(tunnelEvent({ state: 'ready', label: 'port:8080', url: 'https://b.trycloudflare.com' }));
    expect(entries()).toEqual({
      5173: { state: 'starting' },
      8080: { state: 'ready', url: 'https://b.trycloudflare.com', dnsVerified: false },
    });
  });
});

describe('applyPortTunnelEvent — dnsVerified flag (D11)', () => {
  it('a dns_verified event with no prior ready still yields dnsVerified: true', () => {
    applyPortTunnelEvent(
      tunnelEvent({ state: 'dns_verified', label: 'port:5173', url: 'https://a.trycloudflare.com' }),
    );
    expect(entries()).toEqual({ 5173: { state: 'ready', url: 'https://a.trycloudflare.com', dnsVerified: true } });
  });

  it('a late duplicate ready event cannot un-verify an already-verified tunnel', () => {
    applyPortTunnelEvent(tunnelEvent({ state: 'ready', label: 'port:5173', url: 'https://a.trycloudflare.com' }));
    applyPortTunnelEvent(tunnelEvent({ state: 'dns_verified', label: 'port:5173' }));
    applyPortTunnelEvent(tunnelEvent({ state: 'ready', label: 'port:5173', url: 'https://a.trycloudflare.com' }));
    expect(entries()).toEqual({ 5173: { state: 'ready', url: 'https://a.trycloudflare.com', dnsVerified: true } });
  });
});

describe('applyPortTunnelSnapshot — dnsVerified flag (D11, fact 8)', () => {
  it('marks a ready entry dnsVerified: true', () => {
    applyPortTunnelSnapshot([{ port: 5173, state: 'ready', url: 'https://a.trycloudflare.com' }]);
    expect(entries()).toEqual({ 5173: { state: 'ready', url: 'https://a.trycloudflare.com', dnsVerified: true } });
  });

  it('leaves a starting entry without the flag', () => {
    applyPortTunnelSnapshot([{ port: 5173, state: 'starting' }]);
    expect(entries()).toEqual({ 5173: { state: 'starting' } });
  });
});

describe('clearPortTunnelEntry (PD2)', () => {
  it('clears an error entry, bumps generation, and returns true', () => {
    applyPortTunnelEvent(tunnelEvent({ state: 'error', label: 'port:5173', error: 'boom' }));
    const before = portTunnelGeneration();
    expect(clearPortTunnelEntry(5173)).toBe(true);
    expect(entries()).toEqual({});
    expect(portTunnelGeneration()).toBe(before + 1);
  });

  it('clears a starting entry, bumps generation, and returns true', () => {
    applyPortTunnelEvent(tunnelEvent({ state: 'starting', label: 'port:5173' }));
    const before = portTunnelGeneration();
    expect(clearPortTunnelEntry(5173)).toBe(true);
    expect(entries()).toEqual({});
    expect(portTunnelGeneration()).toBe(before + 1);
  });

  it('is a no-op on a ready entry: state/url/dnsVerified survive, returns false, generation unchanged', () => {
    applyPortTunnelEvent(tunnelEvent({ state: 'ready', label: 'port:5173', url: 'https://a.trycloudflare.com' }));
    const before = portTunnelGeneration();
    expect(clearPortTunnelEntry(5173)).toBe(false);
    expect(entries()).toEqual({ 5173: { state: 'ready', url: 'https://a.trycloudflare.com', dnsVerified: false } });
    expect(portTunnelGeneration()).toBe(before);
  });

  it('returns false and leaves the state reference untouched for a port with no entry', () => {
    const before = usePortTunnelsStore.getState();
    expect(clearPortTunnelEntry(5173)).toBe(false);
    expect(usePortTunnelsStore.getState()).toBe(before);
  });
});

describe('applyPortTunnelEvent — label and type filtering', () => {
  it('ignores the daemon-self tunnel', () => {
    applyPortTunnelEvent(tunnelEvent({ state: 'ready', label: 'daemon', url: 'https://daemon.trycloudflare.com' }));
    expect(entries()).toEqual({});
  });

  it('ignores preview tunnels', () => {
    applyPortTunnelEvent(tunnelEvent({ state: 'ready', label: 'preview:abc', url: 'https://p.trycloudflare.com' }));
    expect(entries()).toEqual({});
  });

  it('ignores a malformed port label', () => {
    applyPortTunnelEvent(tunnelEvent({ state: 'starting', label: 'port:notaport' }));
    expect(entries()).toEqual({});
  });

  it('ignores events that are not tunnel:status', () => {
    applyPortTunnelEvent({ type: 'file:changed', path: '/tmp/x' });
    expect(entries()).toEqual({});
  });

  it('leaves the generation untouched for an ignored event', () => {
    const before = portTunnelGeneration();
    applyPortTunnelEvent(tunnelEvent({ state: 'ready', label: 'daemon', url: 'https://daemon.trycloudflare.com' }));
    expect(portTunnelGeneration()).toBe(before);
  });
});

describe('reportPortTunnelError', () => {
  it('raises one toast with the port and the message', () => {
    reportPortTunnelError(5173, 'cloudflared exited');
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('Couldn’t tunnel port 5173', { description: 'cloudflared exited' });
  });

  it('raises a single toast when the same failure arrives twice', () => {
    reportPortTunnelError(5173, 'cloudflared exited');
    reportPortTunnelError(5173, 'cloudflared exited');
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('toasts once per port', () => {
    reportPortTunnelError(5173, 'cloudflared exited');
    reportPortTunnelError(8080, 'cloudflared exited');
    expect(toastError).toHaveBeenCalledTimes(2);
  });

  it('toasts again after the dedupe window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-25T10:00:00Z'));
    reportPortTunnelError(5173, 'cloudflared exited');
    vi.advanceTimersByTime(1001);
    reportPortTunnelError(5173, 'cloudflared exited');
    expect(toastError).toHaveBeenCalledTimes(2);
  });

  it('never downgrades a live tunnel — no state change, no toast', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyPortTunnelEvent(tunnelEvent({ state: 'ready', label: 'port:5173', url: 'https://a.trycloudflare.com' }));

    reportPortTunnelError(5173, 'edge reconnect');

    expect(entries()).toEqual({ 5173: { state: 'ready', url: 'https://a.trycloudflare.com', dnsVerified: false } });
    expect(toastError).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '[port-tunnels] ignoring an error for the live tunnel on port 5173: edge reconnect',
    );
    warn.mockRestore();
  });

  it('ignores an error EVENT for a live tunnel too', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyPortTunnelEvent(tunnelEvent({ state: 'ready', label: 'port:5173', url: 'https://a.trycloudflare.com' }));

    applyPortTunnelEvent(tunnelEvent({ state: 'error', label: 'port:5173', error: 'edge reconnect' }));

    expect(entries()).toEqual({ 5173: { state: 'ready', url: 'https://a.trycloudflare.com', dnsVerified: false } });
    expect(toastError).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does downgrade a starting tunnel', () => {
    applyPortTunnelEvent(tunnelEvent({ state: 'starting', label: 'port:5173' }));
    reportPortTunnelError(5173, 'cloudflared exited');
    expect(entries()).toEqual({ 5173: { state: 'error', error: 'cloudflared exited' } });
  });
});

describe('seedPortTunnels', () => {
  it('applies the snapshot and the daemon’s own port', async () => {
    listPortTunnels.mockResolvedValue({
      daemonPort: 31415,
      tunnels: [
        { port: 5173, state: 'ready', url: 'https://a.trycloudflare.com' },
        { port: 8080, state: 'starting' },
      ],
    });

    seedPortTunnels(31415);
    await vi.waitFor(() => expect(usePortTunnelsStore.getState().daemonPort).toBe(31415));

    expect(listPortTunnels).toHaveBeenCalledWith(31415);
    expect(entries()).toEqual({
      5173: { state: 'ready', url: 'https://a.trycloudflare.com', dnsVerified: true },
      8080: { state: 'starting' },
    });
  });

  it('does not let a late snapshot resurrect a tunnel a WS event just stopped', async () => {
    let resolveList!: (list: PortTunnelsList) => void;
    listPortTunnels.mockReturnValue(new Promise<PortTunnelsList>((r) => (resolveList = r)));

    applyPortTunnelEvent(tunnelEvent({ state: 'ready', label: 'port:5173', url: 'https://a.trycloudflare.com' }));
    seedPortTunnels(31415);
    applyPortTunnelEvent(tunnelEvent({ state: 'stopped', label: 'port:5173' }));

    resolveList({ daemonPort: 31415, tunnels: [{ port: 5173, state: 'ready', url: 'https://a.trycloudflare.com' }] });
    await vi.waitFor(() => expect(usePortTunnelsStore.getState().daemonPort).toBe(31415));

    // daemonPort is snapshot-only, so it still lands; the entries do not.
    expect(entries()).toEqual({});
  });

  it('discards a superseded in-flight seed', async () => {
    let resolveFirst!: (list: PortTunnelsList) => void;
    listPortTunnels.mockReturnValueOnce(new Promise<PortTunnelsList>((r) => (resolveFirst = r)));
    listPortTunnels.mockResolvedValueOnce({
      daemonPort: 31500,
      tunnels: [{ port: 8080, state: 'ready', url: 'https://second.trycloudflare.com' }],
    });

    seedPortTunnels(31415);
    seedPortTunnels(31500);
    await vi.waitFor(() => expect(usePortTunnelsStore.getState().daemonPort).toBe(31500));

    resolveFirst({
      daemonPort: 31415,
      tunnels: [{ port: 5173, state: 'ready', url: 'https://first.trycloudflare.com' }],
    });
    await Promise.resolve();

    expect(usePortTunnelsStore.getState().daemonPort).toBe(31500);
    expect(entries()).toEqual({ 8080: { state: 'ready', url: 'https://second.trycloudflare.com', dnsVerified: true } });
  });

  it('warns and leaves the store alone when the fetch fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = new Error('daemon unreachable');
    listPortTunnels.mockRejectedValue(failure);
    applyPortTunnelEvent(tunnelEvent({ state: 'starting', label: 'port:5173' }));

    seedPortTunnels(31415);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[port-tunnels] seed failed', failure));

    expect(entries()).toEqual({ 5173: { state: 'starting' } });
    expect(usePortTunnelsStore.getState().daemonPort).toBeNull();
    warn.mockRestore();
  });
});

describe('resetPortTunnels', () => {
  it('clears the entries and the daemon port', () => {
    applyPortTunnelSnapshot([{ port: 5173, state: 'ready', url: 'https://a.trycloudflare.com' }]);
    setTunnelDaemonPort(31415);

    resetPortTunnels();

    expect(entries()).toEqual({});
    expect(usePortTunnelsStore.getState().daemonPort).toBeNull();
  });

  it('clears the toast dedupe so the next daemon can report the same port', () => {
    reportPortTunnelError(5173, 'cloudflared exited');
    resetPortTunnels();
    reportPortTunnelError(5173, 'cloudflared exited');
    expect(toastError).toHaveBeenCalledTimes(2);
  });
});

describe('installPortTunnelSubscriber', () => {
  it('registers applyPortTunnelEvent on the daemon socket and returns its unsubscribe', () => {
    const unsubscribe = () => {};
    onEvent.mockReturnValueOnce(unsubscribe);

    expect(installPortTunnelSubscriber()).toBe(unsubscribe);
    expect(onEvent).toHaveBeenCalledWith(applyPortTunnelEvent);
  });
});
