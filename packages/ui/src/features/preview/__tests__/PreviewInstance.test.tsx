/**
 * PreviewInstance — remote-daemon tunnel resolution.
 *
 * Covers the URL-resolution seam added on top of usePreviewLifecycle
 * (Task 6 of docs/plans/2026-07-02-remote-preview-tunnel-plan.md):
 *   - remote + no tunnel url yet → pending body, no webview mount
 *   - remote + tunnel url present → mounts to the tunnel url
 *   - remote + tunnel error → console-fallback body + exactly one toast
 *   - local daemon → byte-for-byte unchanged (localhost mount, no new states)
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { HostProvider, setHostForTesting, resetHostForTesting } from '@/lib/host';
import type { PreviewHandle } from '@qlan-ro/mainframe-types';
import { useSandboxStore } from '@/store/sandbox';
import { mfToast } from '@/lib/toast';
import { useDaemonIsLocal } from '@/lib/daemon/use-daemon-is-local';

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: 'proj', chatId: 'chat-1' }),
}));

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

vi.mock('@/lib/daemon/use-daemon-is-local', () => ({
  useDaemonIsLocal: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  mfToast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { PreviewInstance } from '../PreviewInstance';

const SCOPE = 'proj:/wt';

let fakeHost: FakeHostBridge;
let fakeHandle: PreviewHandle;

beforeEach(() => {
  vi.clearAllMocks();
  fakeHandle = {
    setVisible: vi.fn(),
    compositesAboveDom: true,
    navigate: vi.fn().mockResolvedValue(undefined),
    capture: vi.fn().mockResolvedValue(new Uint8Array()),
    startInspect: vi.fn().mockResolvedValue(undefined),
    onInspect: vi.fn().mockReturnValue(() => {}),
    startRegionSelect: vi.fn().mockResolvedValue(undefined),
    onRegionSelect: vi.fn().mockReturnValue(() => {}),
    onNavigate: vi.fn().mockReturnValue(() => {}),
    refit: vi.fn(),
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
    tunnelUrls: {},
    tunnelErrors: {},
  });
});

afterEach(() => {
  resetHostForTesting();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(HostProvider, { host: fakeHost, children });
}

function renderInstance() {
  return render(<PreviewInstance tabId="t1" config="web" visible scopeKey={SCOPE} port={3000} projectId="proj" />, {
    wrapper,
  });
}

describe('PreviewInstance — remote tunnel resolution', () => {
  it('renders the tunnel-pending state when remote and no url yet', async () => {
    vi.mocked(useDaemonIsLocal).mockReturnValue(false);
    useSandboxStore.getState().setProcessStatus(SCOPE, 'web', 'running');

    renderInstance();

    expect(await screen.findByTestId('preview-tunnel-pending')).toBeInTheDocument();
    expect(fakeHost.preview.mount).not.toHaveBeenCalled();
  });

  it('mounts the webview to the tunnel url when present', async () => {
    vi.mocked(useDaemonIsLocal).mockReturnValue(false);
    useSandboxStore.getState().setProcessStatus(SCOPE, 'web', 'running');
    useSandboxStore.getState().setTunnelUrl(SCOPE, 'web', 'https://web.trycloudflare.com');

    renderInstance();

    await waitFor(() =>
      expect(fakeHost.preview.mount).toHaveBeenCalledWith(
        expect.anything(),
        'https://web.trycloudflare.com',
        expect.objectContaining({ projectId: 'proj' }),
      ),
    );
    expect(screen.queryByTestId('preview-tunnel-pending')).toBeNull();
    expect(screen.queryByTestId('preview-body-tunnel-failed')).toBeNull();
  });

  it('renders the in-body tunnel-failed card and toasts exactly once on tunnel failure', async () => {
    vi.mocked(useDaemonIsLocal).mockReturnValue(false);
    useSandboxStore.getState().setProcessStatus(SCOPE, 'web', 'running');
    useSandboxStore.getState().setTunnelError(SCOPE, 'web', 'cloudflared missing');

    renderInstance();

    expect(await screen.findByTestId('preview-body-tunnel-failed')).toBeInTheDocument();
    expect(screen.getByText('cloudflared missing')).toBeInTheDocument();
    expect(fakeHost.preview.mount).not.toHaveBeenCalled();
    await waitFor(() => expect(mfToast.error).toHaveBeenCalledTimes(1));
    expect(mfToast.error).toHaveBeenCalledWith(expect.stringContaining('cloudflared missing'));
  });

  it('keeps the console drawer (not the full-pane console) on tunnel failure', async () => {
    vi.mocked(useDaemonIsLocal).mockReturnValue(false);
    useSandboxStore.getState().setProcessStatus(SCOPE, 'web', 'running');
    useSandboxStore.getState().setTunnelError(SCOPE, 'web', 'cloudflared missing');

    renderInstance();

    expect(await screen.findByTestId('preview-body-tunnel-failed')).toBeInTheDocument();
    expect(screen.getByTestId('run-console-drawer')).toBeInTheDocument();
    expect(screen.queryByTestId('run-console-pane')).toBeNull();
  });

  it('is unchanged on a local daemon (mounts localhost, no pending/failed state)', async () => {
    vi.mocked(useDaemonIsLocal).mockReturnValue(true);
    useSandboxStore.getState().setProcessStatus(SCOPE, 'web', 'running');

    renderInstance();

    await waitFor(() =>
      expect(fakeHost.preview.mount).toHaveBeenCalledWith(
        expect.anything(),
        'http://localhost:3000',
        expect.anything(),
      ),
    );
    expect(screen.queryByTestId('preview-tunnel-pending')).toBeNull();
    expect(screen.queryByTestId('preview-body-tunnel-failed')).toBeNull();
  });
});
