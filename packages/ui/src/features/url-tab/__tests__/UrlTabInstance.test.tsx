/**
 * UrlTabInstance — toolbar composition and the live address bar (#281, Task 2).
 *
 * Covers AC1 (mounts with no launch config), AC5 (the process-control pair and
 * the preview tab's own toolbar are absent by construction), D9/spec §6 (the
 * address bar stays live and commits even with nothing mounted), AC6 (invalid
 * input never mounts a webview), and the device-toggle/unmount lifecycle.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PreviewHandle } from '@qlan-ro/mainframe-types';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { HostProvider, setHostForTesting, resetHostForTesting } from '@/lib/host';
import { useDaemonIsLocal } from '@/lib/daemon/use-daemon-is-local';
import { useLayoutStore } from '@/store/layout';
import { usePortTunnelsStore } from '@/store/port-tunnels';
import { useSandboxStore } from '@/store/sandbox';

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

const FRESH_LAYOUT = { top: ['workspace' as const], bottom: null as null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } };

/** Seed a single-pane Run holding one `url` tab, so setUrlTabTarget has something to retarget. */
function seedUrlTab(tabId: string, url: string) {
  useLayoutStore.setState({
    layout: { ...FRESH_LAYOUT },
    run: {
      dir: 'v',
      flex: [1],
      panes: [{ id: 'pane-1', active: tabId, tabs: [{ id: tabId, kind: 'url', title: url, url }] }],
    },
    sessions: new Map(),
    activeSessionId: null,
  });
}

let fakeHost: FakeHostBridge;
let fakeHandle: PreviewHandle;

beforeEach(() => {
  vi.clearAllMocks();
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

  useSandboxStore.setState({
    captures: [],
    logsOutput: [],
    selectedConfigByScope: {},
    lastStartedProcess: null,
    processStatuses: {},
  });
  usePortTunnelsStore.setState({ byPort: {}, daemonPort: null, generation: 0 });
  useLayoutStore.setState({ layout: { ...FRESH_LAYOUT }, run: null, sessions: new Map(), activeSessionId: null });
});

afterEach(() => {
  resetHostForTesting();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <HostProvider host={fakeHost}>{children}</HostProvider>;
}

describe('UrlTabInstance — toolbar composition and the live address bar', () => {
  it('mounts the webview for a local daemon with no launch config (AC1)', () => {
    vi.mocked(useDaemonIsLocal).mockReturnValue(true);

    render(<UrlTabInstance tabId="t1" url="http://localhost:5173/" visible />, { wrapper });

    expect(fakeHost.preview.mount).toHaveBeenCalledWith(expect.anything(), 'http://localhost:5173/', {
      projectId: 'proj-A',
      device: 'desktop',
    });
    expect(screen.getByTestId('url-tab-instance-t1')).toBeInTheDocument();
    expect(screen.getByTestId('url-tab-body-loaded')).toBeInTheDocument();
  });

  it('renders exactly the URL-tab control inventory, never the preview tab toolbar or process controls (AC5)', () => {
    vi.mocked(useDaemonIsLocal).mockReturnValue(true);

    render(<UrlTabInstance tabId="t1" url="http://localhost:5173/" visible />, { wrapper });

    const toolbar = screen.getByTestId('url-tab-toolbar');
    expect(toolbar).toBeInTheDocument();
    for (const id of [
      'preview-url-input',
      'preview-url-reload',
      'preview-url-open-browser',
      'preview-url-clear-cache',
      'preview-toolbar-inspect',
      'preview-toolbar-capture',
      'preview-toolbar-region',
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('preview-run-start')).toBeNull();
    expect(screen.queryByTestId('preview-run-stop')).toBeNull();
    expect(screen.queryByTestId('preview-toolbar')).toBeNull();
  });

  it('keeps the address bar live and commits a new address with nothing mounted (spec §6, D9)', () => {
    vi.mocked(useDaemonIsLocal).mockReturnValue(false);
    usePortTunnelsStore.setState({
      byPort: { 9999: { state: 'error', error: 'boom' } },
      daemonPort: 31415,
      generation: 1,
    });
    seedUrlTab('t1', 'http://localhost:9999/');

    render(<UrlTabInstance tabId="t1" url="http://localhost:9999/" visible />, { wrapper });

    expect(screen.getByTestId('url-tab-body-failed')).toBeInTheDocument();
    const input = screen.getByTestId('preview-url-input');
    expect(input).not.toBeDisabled();

    fireEvent.change(input, { target: { value: 'localhost:5173' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const tab = useLayoutStore.getState().run?.panes[0]?.tabs[0];
    expect(tab?.url).toBe('http://localhost:5173/');
    expect(tab?.title).toBe('localhost:5173');
    expect(fakeHost.preview.mount).not.toHaveBeenCalled();
  });

  it('renders the invalid body and never mounts, with the input still enabled (AC6)', () => {
    vi.mocked(useDaemonIsLocal).mockReturnValue(true);

    render(<UrlTabInstance tabId="t1" url="" visible />, { wrapper });

    expect(screen.getByTestId('url-tab-body-invalid')).toBeInTheDocument();
    expect(fakeHost.preview.mount).not.toHaveBeenCalled();
    expect(screen.getByTestId('preview-url-input')).not.toBeDisabled();
  });

  it('flips the device toggle without recreating the webview (reanchor, not remount)', () => {
    vi.mocked(useDaemonIsLocal).mockReturnValue(true);

    render(<UrlTabInstance tabId="t1" url="http://localhost:5173/" visible />, { wrapper });
    expect(fakeHost.preview.mount).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('preview-device-mobile'));

    expect(fakeHost.preview.mount).toHaveBeenCalledTimes(1);
    expect(fakeHandle.reanchor).toHaveBeenCalled();
  });

  it('destroys the webview handle on unmount (AC12)', () => {
    vi.mocked(useDaemonIsLocal).mockReturnValue(true);

    const { unmount } = render(<UrlTabInstance tabId="t1" url="http://localhost:5173/" visible />, { wrapper });
    unmount();

    expect(fakeHandle.destroy).toHaveBeenCalled();
  });
});
