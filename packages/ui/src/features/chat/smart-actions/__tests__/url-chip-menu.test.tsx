/**
 * UrlChip's open menu — row order and the "Open in Mainframe" action (#281,
 * AC4, D7), plus the "Copy link" row shared with the plain-link menu (todo
 * #341). `url-chip.test.tsx` covers the tunnelling behaviour behind the
 * "Open in browser" row; this file stays about the menu itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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

  it('lists Open in browser above Copy link, completing the shared three-row set', async () => {
    renderChip();
    await openMenu();

    const browser = await screen.findByTestId('smart-action-url-open-browser');
    const copy = await screen.findByTestId('smart-action-url-copy');

    expect(browser.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(copy).toHaveTextContent('Copy link');
  });
});

// ---------------------------------------------------------------------------
// Copy link — same feedback mechanism as LinkWithPreview (todo #341), reusing
// `CopyMenuItem` under a `DropdownMenuItem` instead of a `ContextMenuItem`.
//
// NOTE: deliberately uses fireEvent, not userEvent, for both the open and the
// copy click — userEvent.setup() installs its own clipboard stub that shadows
// the mock below (see markdown-text.test.tsx for the confirmed repro).
// ---------------------------------------------------------------------------

describe('UrlChip — copy link feedback', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    writeText.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // userEvent still opens the menu (real pointer events, required for the
  // Radix trigger) but installs its own clipboard stub while doing so, so the
  // mock is reasserted right before the copy click itself, which fires via
  // fireEvent (see markdown-text.test.tsx for the confirmed userEvent repro).
  async function openMenuAsync(): Promise<void> {
    await userEvent.setup({ delay: null }).click(screen.getByTestId('smart-action-url-open'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  }

  async function flushCopy(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('writes the href to the clipboard and shows "Copied" on select', async () => {
    renderChip();
    await openMenuAsync();

    fireEvent.click(screen.getByTestId('smart-action-url-copy'));
    await flushCopy();

    expect(writeText).toHaveBeenCalledWith(HREF);
    expect(screen.getByTestId('smart-action-url-copy')).toHaveTextContent('Copied');
    expect(openExternal).not.toHaveBeenCalled();
    expect(emitSurfaceIntent).not.toHaveBeenCalled();
  });

  it('closes the menu itself after the delay, resetting the feedback for the next open', async () => {
    renderChip();
    await openMenuAsync();

    fireEvent.click(screen.getByTestId('smart-action-url-copy'));
    await flushCopy();
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByTestId('smart-action-url-copy')).toBeNull();

    await openMenuAsync();
    expect(screen.getByTestId('smart-action-url-copy')).toHaveTextContent('Copy link');
  });
});
