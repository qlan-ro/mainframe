/**
 * UrlTabInstance — retargeting and an externally-restarted tunnel never
 * falsely claim a port this tab didn't (still) start (#281, review-fix
 * findings 1+2, AC12/D10).
 *
 * Runs the REAL `tunnel-consumers` registry (only `startPortTunnel`/
 * `stopPortTunnel` are mocked), so a stale-state write that the pure reducer
 * tests can't see — the hook registering `started: true` for one render
 * before correcting itself — shows up as a wrongful `stopPortTunnel` call
 * once the tab is released.
 */
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PreviewHandle } from '@qlan-ro/mainframe-types';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { HostProvider, setHostForTesting, resetHostForTesting } from '@/lib/host';
import { useDaemonIsLocal } from '@/lib/daemon/use-daemon-is-local';
import { useLayoutStore } from '@/store/layout';
import { usePortTunnelsStore } from '@/store/port-tunnels';
import { useSandboxStore } from '@/store/sandbox';
import { startPortTunnel, stopPortTunnel } from '@/lib/api/tunnel-ports';
import { releaseUrlTunnelConsumers, clearUrlTunnelConsumers } from '@/features/url-tab/tunnel-consumers';

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

import { UrlTabInstance } from '../UrlTabInstance';

const FRESH_LAYOUT = { top: ['run' as const], bottom: null as null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } };

let fakeHost: FakeHostBridge;
let fakeHandle: PreviewHandle;

beforeEach(() => {
  vi.clearAllMocks();
  clearUrlTunnelConsumers();
  fakeHandle = {
    setVisible: vi.fn(),
    compositesAboveDom: false,
    navigate: vi.fn().mockResolvedValue(undefined),
    capture: vi.fn().mockResolvedValue(new Uint8Array()),
    startInspect: vi.fn().mockResolvedValue(undefined),
    onInspect: vi.fn().mockReturnValue(() => {}),
    startRegionSelect: vi.fn().mockResolvedValue(undefined),
    onRegionSelect: vi.fn().mockReturnValue(() => {}),
    onNavigate: vi.fn().mockReturnValue(() => {}),
    refit: vi.fn(),
    reanchor: vi.fn(),
    setDevice: vi.fn(),
    destroy: vi.fn(),
  };
  fakeHost = new FakeHostBridge();
  fakeHost.preview.mount = vi.fn().mockReturnValue(fakeHandle);
  setHostForTesting(fakeHost);

  vi.mocked(useDaemonIsLocal).mockReturnValue(false);
  vi.mocked(startPortTunnel).mockResolvedValue({ url: 'https://abc.trycloudflare.com' });
  vi.mocked(stopPortTunnel).mockResolvedValue(undefined);

  useSandboxStore.setState({
    captures: [],
    logsOutput: [],
    selectedConfigByScope: {},
    lastStartedProcess: null,
    processStatuses: {},
  });
  usePortTunnelsStore.setState({ byPort: {}, daemonPort: 31415, generation: 0 });
  useLayoutStore.setState({ layout: { ...FRESH_LAYOUT }, run: null, sessions: new Map(), activeSessionId: null });
});

afterEach(() => {
  resetHostForTesting();
});

describe('UrlTabInstance — retarget onto an already-tunnelled port never adopts as owner', () => {
  it('does not stop the adopted port on release, and still stops the abandoned owned port', async () => {
    const { rerender } = render(<UrlTabInstance tabId="t1" url="http://localhost:5173/" visible />, {
      wrapper: ({ children }) => <HostProvider host={fakeHost}>{children}</HostProvider>,
    });
    await act(async () => {});
    expect(startPortTunnel).toHaveBeenCalledWith(31415, { port: 5173, chatId: 'chat-1' });

    // Port 4000 already carries a ready tunnel started by someone else (e.g. a
    // chat chip) before this tab ever retargets onto it.
    act(() => {
      usePortTunnelsStore.setState((s) => ({
        byPort: { ...s.byPort, 4000: { state: 'ready', url: 'https://xyz.trycloudflare.com', dnsVerified: true } },
        generation: s.generation + 1,
      }));
    });

    await act(async () => {
      rerender(<UrlTabInstance tabId="t1" url="http://localhost:4000/" visible />);
    });

    // The old owned port is abandoned and stopped (AC12/D10 still holds).
    expect(stopPortTunnel).toHaveBeenCalledWith(31415, 5173);
    vi.mocked(stopPortTunnel).mockClear();

    // Releasing the tab must not stop port 4000 — this tab only adopted it.
    releaseUrlTunnelConsumers(['t1']);
    expect(stopPortTunnel).not.toHaveBeenCalledWith(31415, 4000);
  });
});

describe('UrlTabInstance — an externally-restarted tunnel on the owned port is never this tab’s to stop', () => {
  it('drops ownership when the started tunnel disappears, so a later restart by someone else survives release', async () => {
    render(<UrlTabInstance tabId="t1" url="http://localhost:5173/" visible />, {
      wrapper: ({ children }) => <HostProvider host={fakeHost}>{children}</HostProvider>,
    });
    await act(async () => {});
    expect(startPortTunnel).toHaveBeenCalledWith(31415, { port: 5173, chatId: 'chat-1' });

    act(() => {
      usePortTunnelsStore.setState((s) => ({
        byPort: { ...s.byPort, 5173: { state: 'ready', url: 'https://abc.trycloudflare.com', dnsVerified: true } },
        generation: s.generation + 1,
      }));
    });

    // The chat chip's Stop tears the tunnel down — the store entry disappears.
    act(() => {
      usePortTunnelsStore.setState((s) => {
        const byPort = { ...s.byPort };
        delete byPort[5173];
        return { byPort, generation: s.generation + 1 };
      });
    });

    // A different consumer starts a NEW tunnel on the same port; this tab
    // never asked for it and must not claim it.
    act(() => {
      usePortTunnelsStore.setState((s) => ({
        byPort: {
          ...s.byPort,
          5173: { state: 'ready', url: 'https://new-owner.trycloudflare.com', dnsVerified: true },
        },
        generation: s.generation + 1,
      }));
    });

    releaseUrlTunnelConsumers(['t1']);
    expect(stopPortTunnel).not.toHaveBeenCalledWith(31415, 5173);
  });
});

describe('UrlTabInstance — a port abandoned via retarget is never re-adopted as owned on return', () => {
  it('does not stop a foreign tunnel that later appears on a previously-owned, since-abandoned port', async () => {
    const { rerender } = render(<UrlTabInstance tabId="t1" url="http://localhost:5173/" visible />, {
      wrapper: ({ children }) => <HostProvider host={fakeHost}>{children}</HostProvider>,
    });
    await act(async () => {});
    expect(startPortTunnel).toHaveBeenCalledWith(31415, { port: 5173, chatId: 'chat-1' });

    // Retarget onto a port someone else already tunnels, so this tab's own
    // start effect never fires for it — it only adopts.
    act(() => {
      usePortTunnelsStore.setState((s) => ({
        byPort: { ...s.byPort, 4000: { state: 'ready', url: 'https://xyz.trycloudflare.com', dnsVerified: true } },
        generation: s.generation + 1,
      }));
    });
    await act(async () => {
      rerender(<UrlTabInstance tabId="t1" url="http://localhost:4000/" visible />);
    });
    expect(stopPortTunnel).toHaveBeenCalledWith(31415, 5173);
    vi.mocked(stopPortTunnel).mockClear();

    // The abandoned port later gets a fresh, unrelated tunnel (e.g. the chat chip).
    act(() => {
      usePortTunnelsStore.setState((s) => ({
        byPort: { ...s.byPort, 5173: { state: 'ready', url: 'https://foreign.trycloudflare.com', dnsVerified: true } },
        generation: s.generation + 1,
      }));
    });

    await act(async () => {
      rerender(<UrlTabInstance tabId="t1" url="http://localhost:5173/" visible />);
    });

    releaseUrlTunnelConsumers(['t1']);
    expect(stopPortTunnel).not.toHaveBeenCalledWith(31415, 5173);
  });
});

describe('UrlTabInstance — a start POST that itself fails never leaves this tab owning the port', () => {
  it('does not stop a tunnel a different consumer later starts on the same port', async () => {
    vi.mocked(startPortTunnel).mockRejectedValueOnce(new Error('daemon says no'));

    render(<UrlTabInstance tabId="t1" url="http://localhost:5173/" visible />, {
      wrapper: ({ children }) => <HostProvider host={fakeHost}>{children}</HostProvider>,
    });
    await act(async () => {});
    expect(startPortTunnel).toHaveBeenCalledWith(31415, { port: 5173, chatId: 'chat-1' });

    // The chat chip starts its own tunnel on the same port after this tab's start failed.
    act(() => {
      usePortTunnelsStore.setState((s) => ({
        byPort: { ...s.byPort, 5173: { state: 'starting' } },
        generation: s.generation + 1,
      }));
    });
    act(() => {
      usePortTunnelsStore.setState((s) => ({
        byPort: {
          ...s.byPort,
          5173: { state: 'ready', url: 'https://chip-owned.trycloudflare.com', dnsVerified: true },
        },
        generation: s.generation + 1,
      }));
    });

    releaseUrlTunnelConsumers(['t1']);
    expect(stopPortTunnel).not.toHaveBeenCalledWith(31415, 5173);
  });
});

describe('UrlTabInstance — a live tunnel that dies with a daemon-side error is never this tab’s to stop once restarted', () => {
  it('does not stop a tunnel a different consumer restarts after this tab’s own tunnel errors out', async () => {
    render(<UrlTabInstance tabId="t1" url="http://localhost:5173/" visible />, {
      wrapper: ({ children }) => <HostProvider host={fakeHost}>{children}</HostProvider>,
    });
    await act(async () => {});
    expect(startPortTunnel).toHaveBeenCalledWith(31415, { port: 5173, chatId: 'chat-1' });

    // This tab's own tunnel dies with a daemon-side error entry (not a `stopped`).
    act(() => {
      usePortTunnelsStore.setState((s) => ({
        byPort: { ...s.byPort, 5173: { state: 'error', error: 'cloudflared died' } },
        generation: s.generation + 1,
      }));
    });

    // A different consumer restarts a NEW tunnel on the same port.
    act(() => {
      usePortTunnelsStore.setState((s) => ({
        byPort: {
          ...s.byPort,
          5173: { state: 'ready', url: 'https://restarted.trycloudflare.com', dnsVerified: true },
        },
        generation: s.generation + 1,
      }));
    });

    releaseUrlTunnelConsumers(['t1']);
    expect(stopPortTunnel).not.toHaveBeenCalledWith(31415, 5173);
  });
});
