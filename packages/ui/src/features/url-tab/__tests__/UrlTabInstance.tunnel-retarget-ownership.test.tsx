/**
 * UrlTabInstance — retargeting never falsely claims an already-tunnelled port
 * (#281, review-fix findings 1+2, AC12/D10).
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
