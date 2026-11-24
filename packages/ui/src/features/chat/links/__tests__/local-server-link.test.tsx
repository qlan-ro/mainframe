/**
 * A link to a local server (T1d, #279): one link style, opened through the
 * daemon's tunnel when the daemon is remote.
 *
 * The daemon is the state machine: the start POST is only a trigger, and every
 * transition arrives as a `tunnel:status` event. Tests therefore drive the real
 * `store/port-tunnels` with events and keep the POST promise pending, which is
 * also how "the UI never gates on the POST resolving" is asserted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';

const openExternal = vi.fn(() => Promise.resolve());
vi.mock('@/lib/host', () => ({ useHost: () => ({ shell: { openExternal } }) }));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('@/lib/toast', () => ({
  mfToast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

const startPortTunnel = vi.fn<(port: number, body: unknown) => Promise<{ url: string }>>();
const stopPortTunnel = vi.fn<(port: number, portNum: number) => Promise<void>>();
vi.mock('@/lib/api/tunnel-ports', () => ({
  startPortTunnel: (port: number, body: unknown) => startPortTunnel(port, body),
  stopPortTunnel: (port: number, portNum: number) => stopPortTunnel(port, portNum),
  listPortTunnels: vi.fn(),
}));

vi.mock('@/lib/daemon/ws-client', () => ({ daemonWs: { onEvent: () => () => {} } }));

const LOCAL_DAEMON_PORT = 31415;
let daemonIsLocal = false;
let chatId: string | undefined = 'chat-1';

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => LOCAL_DAEMON_PORT }));
vi.mock('@/lib/daemon/use-daemon-is-local', () => ({ useDaemonIsLocal: () => daemonIsLocal }));
vi.mock('@/features/chat/tools/chat-tool-context', () => ({ useChatId: () => chatId }));

const emitSurfaceIntent = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (intent: unknown) => emitSurfaceIntent(intent) }));

import { SmartLink } from '../../smart-actions/SmartLink';
import { SmartActionsProvider } from '../../smart-actions/smart-actions-context';
import {
  applyPortTunnelEvent,
  applyPortTunnelSnapshot,
  resetPortTunnels,
  setTunnelDaemonPort,
} from '@/store/port-tunnels';
import { useUiPrefs } from '@/store/ui-prefs';

const HREF = 'http://localhost:5173/app';
const TUNNEL_URL = 'https://blue-sky-1234.trycloudflare.com';

function renderLinks(...hrefs: string[]) {
  return render(
    <TooltipProvider>
      <SmartActionsProvider>
        {hrefs.map((href) => (
          <SmartLink key={href} href={href}>
            {href}
          </SmartLink>
        ))}
      </SmartActionsProvider>
    </TooltipProvider>,
  );
}
const renderLink = (href = HREF) => renderLinks(href);
const link = (name = HREF) => screen.getByRole('link', { name });
const openMenu = () => fireEvent.contextMenu(link());
const tunnelState = () => screen.getByTestId('chat-link-tunnel-state-5173').textContent;

function emit(event: Omit<Extract<DaemonEvent, { type: 'tunnel:status' }>, 'type'>): void {
  act(() => applyPortTunnelEvent({ type: 'tunnel:status', ...event }));
}

/** A start POST that never settles: the daemon answers over WS long before it resolves. */
function pendingStart(): void {
  startPortTunnel.mockReturnValue(new Promise<{ url: string }>(() => {}));
}

beforeEach(() => {
  daemonIsLocal = false;
  chatId = 'chat-1';
  startPortTunnel.mockReset();
  stopPortTunnel.mockReset();
  stopPortTunnel.mockResolvedValue(undefined);
  vi.clearAllMocks();
  useUiPrefs.setState({ openLinksIn: 'browser' });
});

afterEach(() => {
  resetPortTunnels();
  useUiPrefs.setState({ openLinksIn: 'workspace' });
});

describe('where it opens', () => {
  it('opens a workspace tab by default, which tunnels for itself', async () => {
    useUiPrefs.setState({ openLinksIn: 'workspace' });
    renderLink();
    await userEvent.click(link());
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-url-tab', url: HREF });
    expect(startPortTunnel).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('opens the address itself in the browser on a local daemon, and never mentions a tunnel', async () => {
    daemonIsLocal = true;
    renderLink();
    await userEvent.click(link());
    expect(openExternal).toHaveBeenCalledWith(HREF);
    expect(startPortTunnel).not.toHaveBeenCalled();
    openMenu();
    expect(screen.getByRole('menu').textContent).not.toMatch(/tunnel/i);
  });

  it('keeps the link text as written, in mono', () => {
    renderLink();
    expect(link()).toHaveTextContent('http://localhost:5173/app');
    expect(link()).toHaveClass('font-mono', 'mf-link');
  });
});

describe('through the tunnel, on a remote daemon', () => {
  it('asks for a tunnel and opens it once the daemon says it is ready, while the POST is pending', async () => {
    pendingStart();
    renderLink();
    await userEvent.click(link());
    expect(startPortTunnel).toHaveBeenCalledWith(31415, { port: 5173, chatId: 'chat-1' });
    expect(link()).toHaveAttribute('aria-busy', 'true');

    emit({ state: 'ready', label: 'port:5173', url: TUNNEL_URL });
    emit({ state: 'dns_verified', label: 'port:5173', url: TUNNEL_URL, dnsVerified: true });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith(TUNNEL_URL);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith(
      'Tunnel open — anyone with this link can reach port 5173 on the daemon machine',
    );
  });

  it('does not ask twice while the tunnel is starting', async () => {
    pendingStart();
    renderLink();
    await userEvent.click(link());
    await userEvent.click(link());
    expect(startPortTunnel).toHaveBeenCalledTimes(1);
  });

  it('reopens a known tunnel without starting another', async () => {
    renderLink();
    emit({ state: 'ready', label: 'port:5173', url: TUNNEL_URL });
    await userEvent.click(link());
    expect(openExternal).toHaveBeenCalledWith(TUNNEL_URL);
    expect(startPortTunnel).not.toHaveBeenCalled();
  });

  it('opens a window for the clicked link alone', async () => {
    pendingStart();
    renderLinks(HREF, 'http://127.0.0.1:5173/other');
    await userEvent.click(link());
    emit({ state: 'ready', label: 'port:5173', url: TUNNEL_URL });
    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a chat in scope', async () => {
    chatId = undefined;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderLink();
    await userEvent.click(link());
    expect(startPortTunnel).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('toasts a failed start once and can be tried again', async () => {
    startPortTunnel.mockRejectedValue(new Error('cloudflared is not installed'));
    renderLink();
    await userEvent.click(link());
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError).toHaveBeenCalledWith('Couldn’t tunnel port 5173', {
      description: 'cloudflared is not installed',
    });
    // The daemon's own error event for the same failure must not double-toast.
    emit({ state: 'error', label: 'port:5173', error: 'cloudflared is not installed' });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(link()).not.toHaveAttribute('aria-busy');
    await userEvent.click(link());
    expect(startPortTunnel).toHaveBeenCalledTimes(2);
  });
});

describe('the context menu', () => {
  it('says the tunnel state, and offers to stop only a live one', () => {
    renderLink();
    openMenu();
    expect(tunnelState()).toBe('Opens through a tunnel');
    expect(screen.queryByTestId('chat-link-tunnel-stop-5173')).toBeNull();
    emit({ state: 'starting', label: 'port:5173' });
    expect(tunnelState()).toBe('Opening tunnel…');
    expect(screen.getByTestId('chat-link-tunnel-stop-5173')).toBeInTheDocument();
    emit({ state: 'ready', label: 'port:5173', url: TUNNEL_URL });
    expect(tunnelState()).toBe('Tunnel open');
  });

  it('has nothing to stop once the tunnel failed', () => {
    renderLink();
    emit({ state: 'error', label: 'port:5173', error: 'cloudflared exited' });
    openMenu();
    expect(tunnelState()).toBe('Tunnel failed');
    expect(screen.queryByTestId('chat-link-tunnel-stop-5173')).toBeNull();
  });

  it('stops the tunnel, and keeps saying it is up until the daemon says otherwise', () => {
    renderLink();
    emit({ state: 'ready', label: 'port:5173', url: TUNNEL_URL });
    openMenu();
    fireEvent.click(screen.getByTestId('chat-link-tunnel-stop-5173'));
    expect(stopPortTunnel).toHaveBeenCalledWith(31415, 5173);
    openMenu();
    expect(tunnelState()).toBe('Tunnel open');
    emit({ state: 'stopped', label: 'port:5173' });
    expect(tunnelState()).toBe('Opens through a tunnel');
  });

  it('reports a failed stop', async () => {
    stopPortTunnel.mockRejectedValue(new Error('daemon unreachable'));
    renderLink();
    emit({ state: 'ready', label: 'port:5173', url: TUNNEL_URL });
    openMenu();
    fireEvent.click(screen.getByTestId('chat-link-tunnel-stop-5173'));
    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Couldn’t stop the tunnel on port 5173', {
        description: 'daemon unreachable',
      }),
    );
  });

  it('shows a tunnel seeded by a reload', () => {
    act(() => applyPortTunnelSnapshot([{ port: 5173, state: 'ready', url: TUNNEL_URL }]));
    renderLink();
    openMenu();
    expect(tunnelState()).toBe('Tunnel open');
  });
});

describe('eligibility', () => {
  const tunnels = (href: string) => {
    renderLink(href);
    return link(href).hasAttribute('data-smart-action-port');
  };
  it('leaves out the daemon’s own port, as the daemon reports it', () => {
    act(() => setTunnelDaemonPort(8080));
    expect(tunnels('http://localhost:8080/')).toBe(false);
  });
  it('takes the local fallback port once the daemon reports a different one', () => {
    act(() => setTunnelDaemonPort(8080));
    expect(tunnels('http://localhost:31415/')).toBe(true);
  });
  it('falls back to the local daemon port before the daemon reports its own', () => {
    expect(tunnels('http://localhost:31415/')).toBe(false);
  });
  it.each([
    ['http://localhost:80/', false],
    ['https://example.com/5173', false],
    ['http://localhost:5173/app', true],
    ['http://0.0.0.0:5173/', true],
  ])('%s → %s', (href, expected) => expect(tunnels(href)).toBe(expected));
});
