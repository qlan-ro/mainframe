// @vitest-environment jsdom
/**
 * useWebviewMount — the URL-driven mount lifecycle extracted out of
 * usePreviewLifecycle (#281 Task 16). Both the launch-config preview tab and
 * the URL tab drive this one handle contract, so its five transitions are
 * asserted here rather than through either caller.
 */
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { HostProvider, setHostForTesting, resetHostForTesting } from '@/lib/host';
import type { PreviewHandle } from '@qlan-ro/mainframe-types';

import { useWebviewMount } from '../use-webview-mount';

let fakeHost: FakeHostBridge;
let fakeHandle: PreviewHandle;

beforeEach(() => {
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
    reanchor: vi.fn(),
    setDevice: vi.fn(),
    destroy: vi.fn(),
  };
  fakeHost = new FakeHostBridge();
  fakeHost.preview.mount = vi.fn().mockReturnValue(fakeHandle);
  setHostForTesting(fakeHost);
});

afterEach(() => {
  resetHostForTesting();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(HostProvider, { host: fakeHost, children });
}

function renderMount(
  initialUrl: string | null,
  refs: {
    anchorRef: { current: HTMLDivElement | null };
    containerRef: { current: HTMLDivElement | null };
  },
) {
  return renderHook(
    (props: { url: string | null; device: 'desktop' | 'mobile' }) =>
      useWebviewMount({
        url: props.url,
        anchorRef: refs.anchorRef,
        containerRef: refs.containerRef,
        projectId: 'p1',
        device: props.device,
      }),
    { initialProps: { url: initialUrl, device: 'desktop' as 'desktop' | 'mobile' }, wrapper },
  );
}

function refs(anchor: HTMLDivElement | null = null) {
  return {
    anchorRef: { current: anchor },
    containerRef: { current: document.createElement('div') as HTMLDivElement | null },
  };
}

it('does not mount while the url is null', async () => {
  renderMount(null, refs());
  await act(async () => {});
  expect(fakeHost.preview.mount).not.toHaveBeenCalled();
});

it('mounts on the first non-null url and returns the handle', async () => {
  const r = refs();
  const { result, rerender } = renderMount(null, r);
  await act(async () => {
    rerender({ url: 'http://localhost:3000', device: 'desktop' });
  });
  expect(fakeHost.preview.mount).toHaveBeenCalledWith(
    r.containerRef.current,
    'http://localhost:3000',
    expect.objectContaining({ projectId: 'p1', device: 'desktop' }),
  );
  expect(result.current).toBe(fakeHandle);
});

it('prefers the anchor element over the container as the mount target', async () => {
  const anchor = document.createElement('div');
  const r = refs(anchor);
  renderMount('http://localhost:3000', r);
  await act(async () => {});
  expect(fakeHost.preview.mount).toHaveBeenCalledWith(anchor, 'http://localhost:3000', expect.anything());
});

it('navigates (never remounts) when the url changes', async () => {
  const r = refs();
  const { rerender } = renderMount('http://localhost:3000', r);
  await act(async () => {});
  await act(async () => {
    rerender({ url: 'https://example.com/docs', device: 'desktop' });
  });
  expect(fakeHandle.navigate).toHaveBeenCalledWith('https://example.com/docs');
  expect(fakeHost.preview.mount).toHaveBeenCalledTimes(1);
});

it('reanchors when the mount element is replaced', async () => {
  const anchorA = document.createElement('div');
  const r = refs(anchorA);
  const { rerender } = renderMount('http://localhost:3000', r);
  await act(async () => {});

  const anchorB = document.createElement('div');
  r.anchorRef.current = anchorB;
  await act(async () => {
    rerender({ url: 'http://localhost:3000', device: 'mobile' });
  });
  expect(fakeHandle.reanchor).toHaveBeenCalledWith(anchorB);
  expect(fakeHost.preview.mount).toHaveBeenCalledTimes(1);
});

it('destroys the handle when the url goes back to null', async () => {
  const r = refs();
  const { result, rerender } = renderMount('http://localhost:3000', r);
  await act(async () => {});
  vi.mocked(fakeHandle.destroy).mockClear();

  await act(async () => {
    rerender({ url: null, device: 'desktop' });
  });
  // Without this the native webview stays composited over the app.
  expect(fakeHandle.destroy).toHaveBeenCalledTimes(1);
  expect(result.current).toBeNull();
});

it('remounts after a destroy when a url returns', async () => {
  const r = refs();
  const { rerender } = renderMount('http://localhost:3000', r);
  await act(async () => {});
  await act(async () => {
    rerender({ url: null, device: 'desktop' });
  });
  await act(async () => {
    rerender({ url: 'http://localhost:4000', device: 'desktop' });
  });
  expect(fakeHost.preview.mount).toHaveBeenCalledTimes(2);
  expect(fakeHost.preview.mount).toHaveBeenLastCalledWith(
    r.containerRef.current,
    'http://localhost:4000',
    expect.anything(),
  );
});

it('destroys on unmount', async () => {
  const { unmount } = renderMount('http://localhost:3000', refs());
  await act(async () => {});
  unmount();
  expect(fakeHandle.destroy).toHaveBeenCalled();
});
