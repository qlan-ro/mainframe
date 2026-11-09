/**
 * Behavior tests for useOpenArtifact: every artifact ends up somewhere the user can
 * see it.
 *
 * Mocked seams: the daemon API, host bridge, daemon locality and the surface bus.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const mockPrepare = vi.fn();
const mockOpenExternal = vi.fn().mockResolvedValue(undefined);
const mockPlatform = vi.fn();
const mockEmit = vi.fn();
const mockDaemonKind = vi.fn();

vi.mock('@/lib/api/artifacts', () => ({ prepareArtifactPreview: (url: string) => mockPrepare(url) }));
vi.mock('@/lib/api/http', () => ({ apiBase: () => 'http://127.0.0.1:31415' }));
vi.mock('@/lib/daemon/active-daemon', () => ({ getActiveDaemon: () => ({ kind: mockDaemonKind() }) }));
vi.mock('@/lib/host', () => ({
  useHost: () => ({ app: { platform: mockPlatform }, shell: { openExternal: mockOpenExternal } }),
}));
const mockToast = vi.fn();
vi.mock('@/lib/toast', () => ({ mfToast: { info: (title: string) => mockToast(title) } }));
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (intent: unknown) => mockEmit(intent) }));

import { useOpenArtifact } from '../use-open-artifact';
import { isArtifactUrl } from '../artifact-url';

const URL = 'https://claude.ai/artifact/V1LAdjrXoKC7jVLpHnV1D2';
const READY = { status: 'ready', path: '/api/artifact-preview/V1/179/index', title: 'Coffee Pricing' };
const PREVIEW = 'http://127.0.0.1:31415/api/artifact-preview/V1/179/index';

async function openArtifact() {
  const { result } = renderHook(() => useOpenArtifact());
  await act(() => result.current.open(URL));
  return result;
}

describe('useOpenArtifact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDaemonKind.mockReturnValue('local');
    mockPlatform.mockResolvedValue('darwin');
    mockPrepare.mockResolvedValue(READY);
  });

  it('shows a downloaded artifact in a tab named after it', async () => {
    await openArtifact();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-url-tab', url: PREVIEW, title: 'Coffee Pricing' });
    expect(mockOpenExternal).not.toHaveBeenCalled();
  });

  it('opens the preview as a browser tab on a host with no webview', async () => {
    mockPlatform.mockResolvedValue('browser');
    await openArtifact();
    expect(mockOpenExternal).toHaveBeenCalledWith(PREVIEW);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('sends Docs and Dashboards to claude.ai and says why', async () => {
    mockPrepare.mockResolvedValue({ status: 'unsupported' });
    await openArtifact();
    expect(mockOpenExternal).toHaveBeenCalledWith(URL);
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('can’t show this kind of artifact'));
  });

  it('falls back to claude.ai when the download fails, and says so', async () => {
    mockPrepare.mockRejectedValue(new Error('offline'));
    await openArtifact();
    expect(mockOpenExternal).toHaveBeenCalledWith(URL);
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('couldn’t load this artifact'));
  });

  it('stays quiet when the artifact opens in Mainframe', async () => {
    await openArtifact();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('goes straight to claude.ai on a remote daemon', async () => {
    mockDaemonKind.mockReturnValue('remote');
    await openArtifact();
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockOpenExternal).toHaveBeenCalledWith(URL);
  });

  it('reports the download in progress and clears it afterwards', async () => {
    let finish = (_: unknown) => {};
    mockPrepare.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useOpenArtifact());

    let opened = Promise.resolve();
    act(() => {
      opened = result.current.open(URL);
    });
    expect(result.current.opening).toBe(true);

    await act(async () => {
      finish(READY);
      await opened;
    });
    expect(result.current.opening).toBe(false);
  });
});

describe('isArtifactUrl', () => {
  it('accepts only a whole claude.ai artifact URL', () => {
    expect(isArtifactUrl(URL)).toBe(true);
    expect(isArtifactUrl(`${URL}.evil.example`)).toBe(false);
    expect(isArtifactUrl('https://evil.example/artifact/x')).toBe(false);
    expect(isArtifactUrl('https://claude.ai/artifact/')).toBe(false);
    expect(isArtifactUrl(undefined)).toBe(false);
  });
});
