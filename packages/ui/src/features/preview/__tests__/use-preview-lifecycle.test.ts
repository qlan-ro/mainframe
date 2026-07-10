import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { HostProvider, setHostForTesting, resetHostForTesting } from '@/lib/host';
import type { PreviewHandle } from '@qlan-ro/mainframe-types';

import { usePreviewLifecycle } from '../use-preview-lifecycle';

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

it('does NOT mount before status is running (port-readiness gating)', () => {
  const anchorRef = { current: null };
  const containerRef = { current: document.createElement('div') };
  renderHook(
    () =>
      usePreviewLifecycle({
        status: 'starting',
        port: null,
        resolvedUrl: null,
        anchorRef,
        containerRef,
        projectId: 'p1',
        device: 'desktop',
      }),
    { wrapper },
  );
  expect(fakeHost.preview.mount).not.toHaveBeenCalled();
});

it('mounts using the container as fallback when anchorRef is null (desktop)', async () => {
  const anchorRef = { current: null };
  const containerEl = document.createElement('div');
  const containerRef = { current: containerEl };
  const { rerender } = renderHook(
    (props: { status: string; port: number | null; resolvedUrl: string | null }) =>
      usePreviewLifecycle({
        status: props.status as Parameters<typeof usePreviewLifecycle>[0]['status'],
        port: props.port,
        resolvedUrl: props.resolvedUrl,
        anchorRef,
        containerRef,
        projectId: 'p1',
        device: 'desktop',
      }),
    { initialProps: { status: 'starting', port: null as number | null, resolvedUrl: null as string | null }, wrapper },
  );
  await act(async () => {
    rerender({ status: 'running', port: 3000, resolvedUrl: 'http://localhost:3000' });
  });
  expect(fakeHost.preview.mount).toHaveBeenCalledWith(
    containerEl,
    'http://localhost:3000',
    expect.objectContaining({ projectId: 'p1' }),
  );
});

it('mounts using the anchor element when present (mobile parity)', async () => {
  const anchorEl = document.createElement('div');
  anchorEl.setAttribute('data-anchor', 'phone-frame');
  const anchorRef = { current: anchorEl };
  const containerRef = { current: document.createElement('div') };
  const { rerender } = renderHook(
    (props: { status: string; port: number | null; resolvedUrl: string | null }) =>
      usePreviewLifecycle({
        status: props.status as Parameters<typeof usePreviewLifecycle>[0]['status'],
        port: props.port,
        resolvedUrl: props.resolvedUrl,
        anchorRef,
        containerRef,
        projectId: 'p1',
        device: 'mobile',
      }),
    { initialProps: { status: 'starting', port: null as number | null, resolvedUrl: null as string | null }, wrapper },
  );
  await act(async () => {
    rerender({ status: 'running', port: 3000, resolvedUrl: 'http://localhost:3000' });
  });
  // Mount must use the anchor (phone-frame element), not the container
  expect(fakeHost.preview.mount).toHaveBeenCalledTimes(1);
  // Use toHaveBeenCalledWith with the actual anchor element for identity comparison
  expect(fakeHost.preview.mount).toHaveBeenCalledWith(
    anchorEl,
    'http://localhost:3000',
    expect.objectContaining({ device: 'mobile' }),
  );
});

it('destroys on unmount', async () => {
  const anchorRef = { current: null };
  const containerRef = { current: document.createElement('div') };
  const { unmount } = renderHook(
    () =>
      usePreviewLifecycle({
        status: 'running',
        port: 3000,
        resolvedUrl: 'http://localhost:3000',
        anchorRef,
        containerRef,
        projectId: 'p1',
        device: 'desktop',
      }),
    { wrapper },
  );
  await act(async () => {});
  unmount();
  expect(fakeHandle.destroy).toHaveBeenCalled();
});

it('calls handle.destroy when status transitions from running to stopped', async () => {
  const anchorRef = { current: null };
  const containerRef = { current: document.createElement('div') };
  const { rerender } = renderHook(
    (props: { status: string; port: number | null; resolvedUrl: string | null }) =>
      usePreviewLifecycle({
        status: props.status as Parameters<typeof usePreviewLifecycle>[0]['status'],
        port: props.port,
        resolvedUrl: props.resolvedUrl,
        anchorRef,
        containerRef,
        projectId: 'p1',
        device: 'desktop',
      }),
    {
      initialProps: {
        status: 'running',
        port: 3000 as number | null,
        resolvedUrl: 'http://localhost:3000' as string | null,
      },
      wrapper,
    },
  );
  await act(async () => {});
  vi.mocked(fakeHandle.destroy).mockReset();
  await act(async () => {
    rerender({ status: 'stopped', port: null, resolvedUrl: null });
  });
  expect(fakeHandle.destroy).toHaveBeenCalled();
});

it('calls handle.destroy when the scope entry drops (running → null)', async () => {
  const anchorRef = { current: null };
  const containerRef = { current: document.createElement('div') };
  const { rerender } = renderHook(
    (props: { status: string | null; port: number | null; resolvedUrl: string | null }) =>
      usePreviewLifecycle({
        status: props.status as Parameters<typeof usePreviewLifecycle>[0]['status'],
        port: props.port,
        resolvedUrl: props.resolvedUrl,
        anchorRef,
        containerRef,
        projectId: 'p1',
        device: 'desktop',
      }),
    {
      initialProps: {
        status: 'running' as string | null,
        port: 3000 as number | null,
        resolvedUrl: 'http://localhost:3000' as string | null,
      },
      wrapper,
    },
  );
  await act(async () => {});
  vi.mocked(fakeHandle.destroy).mockReset();
  await act(async () => {
    rerender({ status: null, port: null, resolvedUrl: null });
  });
  // Without the destroy the native webview stays composited over the app.
  expect(fakeHandle.destroy).toHaveBeenCalled();
});

it('reanchors the handle when the anchor node changes while running', async () => {
  const anchorA = document.createElement('div');
  const anchorRef: { current: HTMLDivElement | null } = { current: anchorA };
  const containerRef = { current: document.createElement('div') };
  const { rerender } = renderHook(
    (props: { device: 'desktop' | 'mobile' }) =>
      usePreviewLifecycle({
        status: 'running',
        port: 3000,
        resolvedUrl: 'http://localhost:3000',
        anchorRef,
        containerRef,
        projectId: 'p1',
        device: props.device,
      }),
    { initialProps: { device: 'desktop' as 'desktop' | 'mobile' }, wrapper },
  );
  await act(async () => {});
  expect(fakeHost.preview.mount).toHaveBeenCalledWith(anchorA, expect.any(String), expect.anything());

  // Device toggle: the body remounts the anchor as a different node.
  const anchorB = document.createElement('div');
  anchorRef.current = anchorB;
  await act(async () => {
    rerender({ device: 'mobile' });
  });
  expect(fakeHandle.reanchor).toHaveBeenCalledWith(anchorB);
  // No second mount — the existing webview is re-pointed, not recreated.
  expect(fakeHost.preview.mount).toHaveBeenCalledTimes(1);
});

it('does NOT mount when running but resolvedUrl is null (tunnel pending) and reports pendingTunnel', async () => {
  const anchorRef = { current: null };
  const containerRef = { current: document.createElement('div') };
  const { result } = renderHook(
    () =>
      usePreviewLifecycle({
        status: 'running',
        port: 3000,
        resolvedUrl: null,
        anchorRef,
        containerRef,
        projectId: 'p1',
        device: 'desktop',
      }),
    { wrapper },
  );
  await act(async () => {});
  expect(fakeHost.preview.mount).not.toHaveBeenCalled();
  expect(result.current.pendingTunnel).toBe(true);
});

it('mounts to the tunnel url when resolvedUrl is a remote URL', async () => {
  const anchorRef = { current: null };
  const containerEl = document.createElement('div');
  const containerRef = { current: containerEl };
  const { rerender } = renderHook(
    (props: { resolvedUrl: string | null }) =>
      usePreviewLifecycle({
        status: 'running',
        port: 3000,
        resolvedUrl: props.resolvedUrl,
        anchorRef,
        containerRef,
        projectId: 'p1',
        device: 'desktop',
      }),
    { initialProps: { resolvedUrl: null as string | null }, wrapper },
  );
  await act(async () => {
    rerender({ resolvedUrl: 'https://xyz.trycloudflare.com' });
  });
  expect(fakeHost.preview.mount).toHaveBeenCalledWith(
    containerEl,
    'https://xyz.trycloudflare.com',
    expect.objectContaining({ projectId: 'p1' }),
  );
});
