/**
 * UrlTabInstance — the round-5 tunnel-claim sequences the ownership rework
 * exists to fix, plus the Retry-on-`ready` rule it must not break (#281, D10,
 * AC12).
 *
 * Runs the REAL `tunnel-consumers` registry (only `startPortTunnel`/
 * `stopPortTunnel` are mocked), same as
 * `UrlTabInstance.tunnel-retarget-ownership.test.tsx`, so a wrongly-dropped or
 * wrongly-kept claim shows up as a wrong `stopPortTunnel` call on release
 * rather than as an internal state assertion.
 */
import { screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDaemonIsLocal } from '@/lib/daemon/use-daemon-is-local';
import { usePortTunnelsStore } from '@/store/port-tunnels';
import { startPortTunnel, stopPortTunnel } from '@/lib/api/tunnel-ports';
import { releaseUrlTunnelConsumers, clearUrlTunnelConsumers } from '@/features/url-tab/tunnel-consumers';
import { URL_TAB_TUNNEL_TIMEOUT_MS } from '../resolve-url-target';
import { installFakeHost, seedStores, setPortEntry, renderTab } from './url-tab-tunnel-harness';

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: 'proj-A', chatId: 'chat-1' }),
}));

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

vi.mock('@/lib/daemon/use-daemon-is-local', () => ({
  useDaemonIsLocal: vi.fn(),
}));

vi.mock('@/lib/api/tunnel-ports', () => ({
  startPortTunnel: vi.fn(),
  stopPortTunnel: vi.fn(),
}));

function deletePortEntry(port: number): void {
  usePortTunnelsStore.setState((s) => {
    const byPort = { ...s.byPort };
    delete byPort[port];
    return { byPort, generation: s.generation + 1 };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearUrlTunnelConsumers();
  installFakeHost();
  seedStores();

  vi.mocked(useDaemonIsLocal).mockReturnValue(false);
  vi.mocked(startPortTunnel).mockResolvedValue({ url: 'https://abc.trycloudflare.com' });
  vi.mocked(stopPortTunnel).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('UrlTabInstance — a hung earlier attempt rejects after a successful retry (round-5 defect 1)', () => {
  it('keeps the claim through the stale rejection and still stops the tunnel on release', async () => {
    let rejectFirstAttempt!: (err: unknown) => void;
    vi.mocked(startPortTunnel).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirstAttempt = reject;
        }),
    );
    vi.mocked(startPortTunnel).mockResolvedValue({ url: 'https://abc.trycloudflare.com' });

    renderTab('http://localhost:5173/');

    act(() => {
      setPortEntry(5173, { state: 'error', error: 'boom' });
    });
    expect(screen.getByTestId('url-tab-body-failed')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('url-tab-retry'));
    });
    expect(startPortTunnel).toHaveBeenCalledTimes(2);

    act(() => {
      setPortEntry(5173, { state: 'ready', url: 'https://abc.trycloudflare.com', dnsVerified: true });
    });
    expect(screen.getByTestId('url-tab-body-loaded')).toBeInTheDocument();

    await act(async () => {
      rejectFirstAttempt(new Error('transport died'));
    });

    expect(screen.getByTestId('url-tab-body-loaded')).toBeInTheDocument();
    releaseUrlTunnelConsumers(['t1']);
    expect(stopPortTunnel).toHaveBeenCalledWith(31415, 5173);
  });
});

describe('UrlTabInstance — the non-terminal watchdog fires, then the tunnel becomes ready (round-5 defect 2)', () => {
  it('keeps the claim through the watchdog and still stops the tunnel on release', async () => {
    vi.useFakeTimers();
    vi.mocked(startPortTunnel).mockImplementation(() => new Promise(() => {}));

    renderTab('http://localhost:5173/');

    act(() => {
      setPortEntry(5173, { state: 'starting' });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(URL_TAB_TUNNEL_TIMEOUT_MS);
    });
    expect(screen.getByTestId('url-tab-body-failed')).toBeInTheDocument();

    act(() => {
      setPortEntry(5173, { state: 'ready', url: 'https://abc.trycloudflare.com', dnsVerified: true });
    });
    expect(screen.getByTestId('url-tab-body-loaded')).toBeInTheDocument();

    releaseUrlTunnelConsumers(['t1']);
    expect(stopPortTunnel).toHaveBeenCalledWith(31415, 5173);
  });
});

describe('UrlTabInstance — Retry pressed while the entry is ready never re-adopts a later, foreign restart', () => {
  it('does not stop a tunnel a different consumer starts after this tab’s own ready-but-unverified tunnel times out and Retry is pressed', async () => {
    vi.useFakeTimers();
    vi.mocked(startPortTunnel).mockImplementation(() => new Promise(() => {}));

    renderTab('http://localhost:5173/');

    act(() => {
      setPortEntry(5173, { state: 'ready', url: 'https://abc.trycloudflare.com' });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(URL_TAB_TUNNEL_TIMEOUT_MS);
    });
    expect(screen.getByTestId('url-tab-body-failed')).toBeInTheDocument();

    // clearPortTunnelEntry no-ops on a `ready` entry, so this never fires a
    // start POST for a new attempt — it only resets the per-attempt flags.
    await act(async () => {
      fireEvent.click(screen.getByTestId('url-tab-retry'));
    });

    // The daemon stops this tab's tunnel and a different consumer starts a
    // brand-new, foreign one on the same port — one batch, so this tab's
    // `entry` never renders an intermediate `undefined` that would make it
    // look like a fresh port ready for this tab's own next attempt to adopt.
    act(() => {
      deletePortEntry(5173);
      setPortEntry(5173, { state: 'ready', url: 'https://foreign.trycloudflare.com', dnsVerified: true });
    });

    releaseUrlTunnelConsumers(['t1']);
    expect(stopPortTunnel).not.toHaveBeenCalledWith(31415, 5173);
  });
});

describe('UrlTabInstance — a session-switch unmount does not lose this tab’s claim (review-fix finding 1/3)', () => {
  it('remounts against an already-ready port, still owns the claim, and stops the tunnel on release', async () => {
    const { unmount } = renderTab('http://localhost:5173/');

    act(() => {
      setPortEntry(5173, { state: 'ready', url: 'https://abc.trycloudflare.com', dnsVerified: true });
    });
    expect(screen.getByTestId('url-tab-body-loaded')).toBeInTheDocument();
    expect(startPortTunnel).toHaveBeenCalledTimes(1);

    // A session switch unmounts the tab without ever releasing it — the port
    // entry stays `ready`, so no new start is issued on remount.
    unmount();

    renderTab('http://localhost:5173/');
    expect(screen.getByTestId('url-tab-body-loaded')).toBeInTheDocument();
    expect(startPortTunnel).toHaveBeenCalledTimes(1);

    releaseUrlTunnelConsumers(['t1']);
    expect(stopPortTunnel).toHaveBeenCalledWith(31415, 5173);
  });
});
