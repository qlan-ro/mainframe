/**
 * UrlChip + SmartLink — the localhost tunnel chip (#279, AC #279.1–6).
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

import { UrlChip } from '../UrlChip';
import { SmartLink } from '../SmartLink';
import { SmartActionsProvider } from '../smart-actions-context';
import {
  applyPortTunnelEvent,
  applyPortTunnelSnapshot,
  resetPortTunnels,
  setTunnelDaemonPort,
} from '@/store/port-tunnels';

const HREF = 'http://localhost:5173/app';
const PORT = 5173;
const TUNNEL_URL = 'https://blue-sky-1234.trycloudflare.com';

function renderChip(href = HREF, port = PORT) {
  return render(
    <TooltipProvider>
      <UrlChip href={href} port={port} />
    </TooltipProvider>,
  );
}

function renderLink(href: string) {
  return render(
    <TooltipProvider>
      <SmartActionsProvider>
        <SmartLink href={href}>{href}</SmartLink>
      </SmartActionsProvider>
    </TooltipProvider>,
  );
}

function emit(event: Omit<Extract<DaemonEvent, { type: 'tunnel:status' }>, 'type'>): void {
  act(() => applyPortTunnelEvent({ type: 'tunnel:status', ...event }));
}

function openButton(): HTMLElement {
  return screen.getByTestId('smart-action-url-open');
}

/**
 * The open control is a menu since #281 — every browser-open assertion below
 * goes through it. This file stays about tunnelling; the menu itself (row order,
 * the in-app row) is covered separately.
 */
async function openInBrowser(trigger: HTMLElement = openButton()): Promise<void> {
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByTestId('smart-action-url-open-browser'));
}

/** A start POST that never settles — the daemon answers over WS long before it resolves. */
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
});

afterEach(() => {
  resetPortTunnels();
});

describe('UrlChip — local daemon', () => {
  beforeEach(() => {
    daemonIsLocal = true;
  });

  it('opens the localhost URL directly and never mentions tunnelling', async () => {
    const { container } = renderChip();

    expect(openButton()).toHaveAttribute('title', 'Open');
    expect(openButton()).toHaveAttribute('aria-label', 'Open');
    expect(openButton()).toBeEnabled();
    expect(screen.queryByTestId('smart-action-url-stop-tunnel')).toBeNull();
    expect(container.textContent).toBe('http://localhost:5173/app');

    await openInBrowser();

    expect(openExternal).toHaveBeenCalledWith(HREF);
    expect(startPortTunnel).not.toHaveBeenCalled();
  });

  it('shows no badge and no stop control even when the port has a tunnel', () => {
    renderChip();
    emit({ state: 'ready', label: 'port:5173', url: TUNNEL_URL });

    expect(screen.queryByText('tunnelled')).toBeNull();
    expect(screen.queryByTestId('smart-action-url-stop-tunnel')).toBeNull();
    expect(openButton()).toHaveAttribute('title', 'Open');
  });

  it('carries the port on the chip root', () => {
    const { container } = renderChip();
    expect(container.querySelector('[data-smart-action-port]')).toHaveAttribute('data-smart-action-port', '5173');
  });
});

describe('UrlChip — remote daemon, first open', () => {
  it('asks the daemon to tunnel the port for the active chat', async () => {
    pendingStart();
    renderChip();

    expect(openButton()).toHaveAttribute('title', 'Tunnel and open');
    await openInBrowser();

    expect(startPortTunnel).toHaveBeenCalledTimes(1);
    expect(startPortTunnel).toHaveBeenCalledWith(31415, { port: 5173, chatId: 'chat-1' });
    expect(openButton()).toBeDisabled();
    // The badge answers the click, not the daemon's first event (AC #279.1).
    expect(screen.getByText('tunnelling…')).toBeInTheDocument();
  });

  it('reaches tunnelled and opens the event URL while the start POST is still pending', async () => {
    pendingStart();
    renderChip();
    await openInBrowser();

    emit({ state: 'starting', label: 'port:5173' });
    expect(screen.getByText('tunnelling…')).toBeInTheDocument();
    expect(openButton()).toBeDisabled();

    emit({ state: 'ready', label: 'port:5173', url: TUNNEL_URL });

    expect(screen.getByText('tunnelled')).toBeInTheDocument();
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith(TUNNEL_URL);
    expect(openButton()).toBeEnabled();
    expect(openButton()).toHaveAttribute('title', 'Reopen tunnel URL');
  });

  it('warns that the link is public exactly once', async () => {
    pendingStart();
    renderChip();
    await openInBrowser();
    emit({ state: 'ready', label: 'port:5173', url: TUNNEL_URL });

    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith(
      'Tunnel open — anyone with this link can reach port 5173 on the daemon machine',
    );
  });

  it('does not reopen on the dns_verified event that follows ready', async () => {
    pendingStart();
    renderChip();
    await openInBrowser();
    emit({ state: 'ready', label: 'port:5173', url: TUNNEL_URL });
    emit({ state: 'dns_verified', label: 'port:5173', url: TUNNEL_URL, dnsVerified: true });

    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(screen.getByText('tunnelled')).toBeInTheDocument();
  });

  it('does nothing without a chat in scope', async () => {
    chatId = undefined;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderChip();

    await openInBrowser();

    expect(startPortTunnel).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[smart-actions] no chat id in scope; cannot start a port tunnel');
    warn.mockRestore();
  });
});

describe('UrlChip — a second chip on the same port', () => {
  it('shares the tunnel state but only the clicked chip opens a window', async () => {
    pendingStart();
    render(
      <TooltipProvider>
        <UrlChip href={HREF} port={PORT} />
        <UrlChip href="http://127.0.0.1:5173/other" port={PORT} />
      </TooltipProvider>,
    );

    await openInBrowser(screen.getAllByTestId('smart-action-url-open')[0]!);
    emit({ state: 'ready', label: 'port:5173', url: TUNNEL_URL });

    expect(screen.getAllByText('tunnelled')).toHaveLength(2);
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith(TUNNEL_URL);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });
});

describe('UrlChip — reopen', () => {
  it('opens the known tunnel URL without starting a second tunnel', async () => {
    renderChip();
    emit({ state: 'ready', label: 'port:5173', url: TUNNEL_URL });

    await openInBrowser();

    expect(openExternal).toHaveBeenCalledWith(TUNNEL_URL);
    expect(startPortTunnel).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe('UrlChip — stop control', () => {
  it('is absent until a tunnel exists', () => {
    renderChip();
    expect(screen.queryByTestId('smart-action-url-stop-tunnel')).toBeNull();
  });

  it('is available while the tunnel is starting', () => {
    renderChip();
    emit({ state: 'starting', label: 'port:5173' });
    expect(screen.getByTestId('smart-action-url-stop-tunnel')).toHaveAttribute('title', 'Stop tunnel');
    expect(screen.getByTestId('smart-action-url-stop-tunnel')).toHaveAttribute('aria-label', 'Stop tunnel');
  });

  it('asks the daemon to stop and waits for the stopped event to clear the chip', () => {
    renderChip();
    emit({ state: 'ready', label: 'port:5173', url: TUNNEL_URL });

    fireEvent.click(screen.getByTestId('smart-action-url-stop-tunnel'));

    expect(stopPortTunnel).toHaveBeenCalledWith(31415, 5173);
    // No optimistic removal: the tunnel is still up until the daemon says so.
    expect(screen.getByText('tunnelled')).toBeInTheDocument();

    emit({ state: 'stopped', label: 'port:5173' });

    expect(screen.queryByText('tunnelled')).toBeNull();
    expect(screen.queryByTestId('smart-action-url-stop-tunnel')).toBeNull();
    expect(openButton()).toHaveAttribute('title', 'Tunnel and open');
  });

  it('reports a failed stop', async () => {
    stopPortTunnel.mockRejectedValue(new Error('daemon unreachable'));
    renderChip();
    emit({ state: 'ready', label: 'port:5173', url: TUNNEL_URL });

    fireEvent.click(screen.getByTestId('smart-action-url-stop-tunnel'));
    await vi.waitFor(() => expect(toastError).toHaveBeenCalled());

    expect(toastError).toHaveBeenCalledWith('Couldn’t stop the tunnel on port 5173', {
      description: 'daemon unreachable',
    });
  });

  it('is absent on an errored entry — nothing is left to stop', () => {
    renderChip();
    emit({ state: 'error', label: 'port:5173', error: 'cloudflared exited' });

    expect(screen.getByText('tunnel failed')).toBeInTheDocument();
    expect(screen.queryByTestId('smart-action-url-stop-tunnel')).toBeNull();
  });
});

describe('UrlChip — failed start', () => {
  it('marks the chip failed, re-enables it, and toasts once for both failure paths', async () => {
    startPortTunnel.mockRejectedValue(new Error('cloudflared is not installed'));
    renderChip();

    await openInBrowser();
    await vi.waitFor(() => expect(screen.getByText('tunnel failed')).toBeInTheDocument());

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('Couldn’t tunnel port 5173', {
      description: 'cloudflared is not installed',
    });
    expect(openButton()).toBeEnabled();
    expect(openButton()).toHaveAttribute('title', 'Tunnel and open');
    expect(openExternal).not.toHaveBeenCalled();

    // The daemon's own error event for the same failure must not double-toast.
    emit({ state: 'error', label: 'port:5173', error: 'cloudflared is not installed' });
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('re-enables the button on a daemon error event while the POST hangs', async () => {
    pendingStart();
    renderChip();
    await openInBrowser();
    emit({ state: 'starting', label: 'port:5173' });
    expect(openButton()).toBeDisabled();

    emit({ state: 'error', label: 'port:5173', error: 'tunnel died' });

    expect(screen.getByText('tunnel failed')).toBeInTheDocument();
    expect(openButton()).toBeEnabled();
  });

  it('does not open a window when a later ready arrives after the failure', async () => {
    pendingStart();
    renderChip();
    await openInBrowser();
    emit({ state: 'error', label: 'port:5173', error: 'tunnel died' });
    emit({ state: 'ready', label: 'port:5173', url: TUNNEL_URL });

    expect(openExternal).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe('UrlChip — reload seed', () => {
  it('shows a seeded starting tunnel as in-progress, not as a start button', () => {
    act(() => applyPortTunnelSnapshot([{ port: PORT, state: 'starting' }]));
    renderChip();

    expect(screen.getByText('tunnelling…')).toBeInTheDocument();
    expect(openButton()).toBeDisabled();
  });

  it('shows a seeded ready tunnel as tunnelled and reopens it without a POST', async () => {
    act(() => applyPortTunnelSnapshot([{ port: PORT, state: 'ready', url: TUNNEL_URL }]));
    renderChip();

    expect(screen.getByText('tunnelled')).toBeInTheDocument();
    await openInBrowser();

    expect(openExternal).toHaveBeenCalledWith(TUNNEL_URL);
    expect(startPortTunnel).not.toHaveBeenCalled();
  });
});

describe('SmartLink — eligibility against the daemon’s own port', () => {
  it('does not chip the daemon’s own port as the daemon reported it', () => {
    act(() => setTunnelDaemonPort(8080));
    const { container } = renderLink('http://localhost:8080/');

    expect(screen.queryByTestId('smart-action-url-open')).toBeNull();
    expect(container.querySelector('a')).toHaveAttribute('href', 'http://localhost:8080/');
  });

  it('chips the local fallback port once the daemon reports a different one', () => {
    act(() => setTunnelDaemonPort(8080));
    renderLink('http://localhost:31415/');

    expect(screen.getByTestId('smart-action-url-open')).toBeInTheDocument();
  });

  it('falls back to the local daemon port before the seed lands', () => {
    const { container } = renderLink('http://localhost:31415/');

    expect(screen.queryByTestId('smart-action-url-open')).toBeNull();
    expect(container.querySelector('a')).toHaveAttribute('href', 'http://localhost:31415/');
  });

  it('does not chip a privileged port', () => {
    const { container } = renderLink('http://localhost:80/');

    expect(screen.queryByTestId('smart-action-url-open')).toBeNull();
    expect(container.querySelector('a')).toHaveAttribute('href', 'http://localhost:80/');
  });

  it('does not chip a non-localhost link', () => {
    const { container } = renderLink('https://example.com/5173');

    expect(screen.queryByTestId('smart-action-url-open')).toBeNull();
    expect(container.querySelector('a')).toHaveAttribute('href', 'https://example.com/5173');
  });

  it('chips an eligible localhost link', () => {
    renderLink('http://localhost:5173/app');

    expect(screen.getByTestId('smart-action-url-open')).toBeInTheDocument();
    expect(screen.getByText('http://localhost:5173/app')).toBeInTheDocument();
  });
});
