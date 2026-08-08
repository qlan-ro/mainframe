/**
 * UrlTabInstance — tunnel adoption, ownership, retry, DNS reload (#281, Task 3).
 *
 * Every case runs on a remote daemon against `http://localhost:5173/app?x=1`
 * unless noted, exercising `useUrlTabTunnel` through the mounted component so
 * the ownership registration and the mount seam are proven together.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PreviewHandle } from '@qlan-ro/mainframe-types';
import type { FakeHostBridge } from '@/lib/host/fake-adapter';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HostProvider, resetHostForTesting } from '@/lib/host';
import { useDaemonIsLocal } from '@/lib/daemon/use-daemon-is-local';
import { usePortTunnelsStore } from '@/store/port-tunnels';
import { startPortTunnel } from '@/lib/api/tunnel-ports';
import { registerUrlTunnelConsumer } from '@/features/url-tab/tunnel-consumers';
import { clearStoredClaims } from '@/features/url-tab/tunnel-claim-registry';
import { installFakeHost, seedStores, setPortEntry, renderTab as renderUrlTab } from './url-tab-tunnel-harness';

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

vi.mock('@/features/url-tab/tunnel-consumers', () => ({
  registerUrlTunnelConsumer: vi.fn(),
  releaseUrlTunnelConsumers: vi.fn(),
  clearUrlTunnelConsumers: vi.fn(),
}));

import { UrlTabInstance } from '../UrlTabInstance';

const URL = 'http://localhost:5173/app?x=1';
const TUNNEL_URL = 'https://abc.trycloudflare.com/app?x=1';

let fakeHost: FakeHostBridge;
let fakeHandle: PreviewHandle;

function renderTab(url = URL) {
  return renderUrlTab(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  // `tunnel-consumers` is mocked wholesale above, so its own `clearUrlTunnelConsumers`
  // never reaches the real claim registry every case here re-seeds under 't1' —
  // clear it directly or a claim a prior case earned leaks into the next one.
  clearStoredClaims();
  ({ fakeHost, fakeHandle } = installFakeHost());
  seedStores();

  vi.mocked(useDaemonIsLocal).mockReturnValue(false);
  vi.mocked(startPortTunnel).mockResolvedValue({ url: TUNNEL_URL.replace('/app?x=1', '') });
});

afterEach(() => {
  resetHostForTesting();
});

describe('UrlTabInstance — rehydrated tabs stay unmounted until first activation', () => {
  it('requests no tunnel and mounts no webview while never visible, then does both on first activation', async () => {
    const { rerender } = render(<UrlTabInstance tabId="t1" url={URL} visible={false} />, {
      // The url-tab toolbar is full of v2 `Hint`s — the v2 TooltipProvider is part of the stack.
      wrapper: ({ children }) => (
        <HostProvider host={fakeHost}>
          <TooltipProvider>{children}</TooltipProvider>
        </HostProvider>
      ),
    });

    expect(fakeHost.preview.mount).not.toHaveBeenCalled();
    expect(startPortTunnel).not.toHaveBeenCalled();
    expect(registerUrlTunnelConsumer).not.toHaveBeenCalled();

    await act(async () => {
      rerender(<UrlTabInstance tabId="t1" url={URL} visible />);
    });

    expect(startPortTunnel).toHaveBeenCalledTimes(1);
    expect(registerUrlTunnelConsumer).toHaveBeenCalled();
    expect(fakeHost.preview.mount).toHaveBeenCalledWith(expect.anything(), TUNNEL_URL, expect.anything());
  });

  it('stays mounted once activated even after switching to another tab (visible false again)', async () => {
    const { rerender } = renderTab();
    await act(async () => {});
    expect(fakeHost.preview.mount).toHaveBeenCalledTimes(1);

    rerender(<UrlTabInstance tabId="t1" url={URL} visible={false} />);

    expect(fakeHandle.destroy).not.toHaveBeenCalled();
    expect(startPortTunnel).toHaveBeenCalledTimes(1);
  });
});

describe('UrlTabInstance — tunnel adoption and ownership', () => {
  it('a fresh start owns the tunnel (D10, AC12)', () => {
    renderTab();

    expect(screen.getByTestId('url-tab-body-pending')).toBeInTheDocument();
    expect(startPortTunnel).toHaveBeenCalledTimes(1);
    expect(startPortTunnel).toHaveBeenCalledWith(31415, { port: 5173, chatId: 'chat-1' });
    expect(registerUrlTunnelConsumer).toHaveBeenLastCalledWith('t1', {
      port: 5173,
      started: true,
      daemonHttpPort: 31415,
    });
  });

  it('adopting a mid-start tunnel issues its own start but does not own it', () => {
    setPortEntry(5173, { state: 'starting' });

    renderTab();

    expect(startPortTunnel).toHaveBeenCalledTimes(1);
    expect(registerUrlTunnelConsumer).toHaveBeenLastCalledWith('t1', {
      port: 5173,
      started: false,
      daemonHttpPort: 31415,
    });
  });

  it('a ready tunnel skips pending and carries the original path/query (D12, AC8)', () => {
    setPortEntry(5173, { state: 'ready', url: 'https://abc.trycloudflare.com', dnsVerified: true });

    renderTab();

    expect(screen.queryByTestId('url-tab-body-pending')).toBeNull();
    expect(fakeHost.preview.mount).toHaveBeenCalledWith(expect.anything(), TUNNEL_URL, expect.anything());
  });

  it('reloads exactly once when DNS verifies after the tab already loaded (D11)', () => {
    setPortEntry(5173, { state: 'ready', url: 'https://abc.trycloudflare.com', dnsVerified: false });

    renderTab();
    expect(fakeHost.preview.mount).toHaveBeenCalledWith(expect.anything(), TUNNEL_URL, expect.anything());
    expect(fakeHandle.navigate).not.toHaveBeenCalled();

    act(() => {
      setPortEntry(5173, { state: 'ready', url: 'https://abc.trycloudflare.com', dnsVerified: true });
    });
    expect(fakeHandle.navigate).toHaveBeenCalledTimes(1);
    expect(fakeHandle.navigate).toHaveBeenCalledWith(TUNNEL_URL);

    // A later, unrelated re-set of the same ready+verified entry adds no further reload.
    act(() => {
      setPortEntry(5173, { state: 'ready', url: 'https://abc.trycloudflare.com', dnsVerified: true });
    });
    expect(fakeHandle.navigate).toHaveBeenCalledTimes(1);
  });

  it('short-circuits a rejected port below 1024 without requesting a tunnel (AC10)', () => {
    renderTab('http://localhost:22/');

    const body = screen.getByTestId('url-tab-body-rejected');
    expect(body.textContent).toContain('Port must be 1024 or higher');
    expect(startPortTunnel).not.toHaveBeenCalled();
  });

  it("short-circuits a rejected daemon's-own-port without requesting a tunnel (AC10)", () => {
    renderTab('http://localhost:31415/');

    const body = screen.getByTestId('url-tab-body-rejected');
    expect(body.textContent).toContain("Cannot tunnel the daemon's own port");
    expect(startPortTunnel).not.toHaveBeenCalled();
  });

  it('retry re-requests after clearing the stale error entry (PD1, AC9)', () => {
    setPortEntry(5173, { state: 'error', error: 'boom' });

    renderTab();
    expect(screen.getByTestId('url-tab-body-failed')).toBeInTheDocument();
    expect(startPortTunnel).not.toHaveBeenCalled();

    act(() => {
      fireEvent.click(screen.getByTestId('url-tab-retry'));
    });

    expect(usePortTunnelsStore.getState().byPort[5173]).toBeUndefined();
    expect(startPortTunnel).toHaveBeenCalledTimes(1);
  });

  it('a ready entry has no retry to click — it is never cleared (PD2)', () => {
    setPortEntry(5173, { state: 'ready', url: 'https://abc.trycloudflare.com', dnsVerified: true });

    renderTab();

    expect(screen.getByTestId('url-tab-body-loaded')).toBeInTheDocument();
    expect(screen.queryByTestId('url-tab-retry')).toBeNull();
  });
});
