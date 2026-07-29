/**
 * UrlChip's open menu — row order and the "Open in Mainframe" action (#281,
 * AC4, D7). `url-chip.test.tsx` covers the tunnelling behaviour behind the
 * "Open in browser" row; this file stays about the menu itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';

const openExternal = vi.fn(() => Promise.resolve());
vi.mock('@/lib/host', () => ({ useHost: () => ({ shell: { openExternal } }) }));

vi.mock('@/lib/toast', () => ({ mfToast: { success: vi.fn(), error: vi.fn() } }));

const startPortTunnel = vi.fn<(port: number, body: unknown) => Promise<{ url: string }>>();
const stopPortTunnel = vi.fn<(port: number, portNum: number) => Promise<void>>();
vi.mock('@/lib/api/tunnel-ports', () => ({
  startPortTunnel: (port: number, body: unknown) => startPortTunnel(port, body),
  stopPortTunnel: (port: number, portNum: number) => stopPortTunnel(port, portNum),
  listPortTunnels: vi.fn(),
}));

vi.mock('@/lib/daemon/ws-client', () => ({ daemonWs: { onEvent: () => () => {} } }));

const emitSurfaceIntent = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (intent: unknown) => emitSurfaceIntent(intent) }));

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('@/lib/daemon/use-daemon-is-local', () => ({ useDaemonIsLocal: () => true }));
vi.mock('@/features/chat/tools/chat-tool-context', () => ({ useChatId: () => 'chat-1' }));

import { UrlChip } from '../UrlChip';
import { resetPortTunnels } from '@/store/port-tunnels';

const HREF = 'http://localhost:5173/app';
const PORT = 5173;

function renderChip() {
  return render(
    <TooltipProvider>
      <UrlChip href={HREF} port={PORT} />
    </TooltipProvider>,
  );
}

async function openMenu(): Promise<void> {
  await userEvent.click(screen.getByTestId('smart-action-url-open'));
}

beforeEach(() => {
  emitSurfaceIntent.mockReset();
  startPortTunnel.mockReset();
  stopPortTunnel.mockReset();
  openExternal.mockClear();
});

afterEach(() => {
  resetPortTunnels();
});

describe('UrlChip — open menu', () => {
  it('lists Open in Mainframe above Open in browser', async () => {
    renderChip();
    await openMenu();

    const inApp = await screen.findByTestId('smart-action-url-open-in-app');
    const browser = await screen.findByTestId('smart-action-url-open-browser');

    expect(inApp.compareDocumentPosition(browser) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(inApp).toHaveTextContent('Open in Mainframe');
    expect(browser).toHaveTextContent('Open in browser');
  });

  it('the in-app row emits one open-url-tab intent with the chip href and starts no tunnel or OS opener', async () => {
    renderChip();
    await openMenu();
    await userEvent.click(await screen.findByTestId('smart-action-url-open-in-app'));

    expect(emitSurfaceIntent).toHaveBeenCalledTimes(1);
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-url-tab', url: HREF });
    expect(startPortTunnel).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('the browser row still calls the pre-existing opener', async () => {
    renderChip();
    await openMenu();
    await userEvent.click(await screen.findByTestId('smart-action-url-open-browser'));

    expect(openExternal).toHaveBeenCalledWith(HREF);
    expect(emitSurfaceIntent).not.toHaveBeenCalled();
  });
});
