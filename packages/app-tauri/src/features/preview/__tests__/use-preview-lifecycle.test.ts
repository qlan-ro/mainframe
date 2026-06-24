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
    navigate: vi.fn().mockResolvedValue(undefined),
    capture: vi.fn().mockResolvedValue(new Uint8Array()),
    startInspect: vi.fn().mockResolvedValue(undefined),
    onInspect: vi.fn().mockReturnValue(() => {}),
    refit: vi.fn(),
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
  const containerRef = { current: document.createElement('div') };
  renderHook(
    () => usePreviewLifecycle({ status: 'starting', port: null, containerRef, projectId: 'p1', device: 'desktop' }),
    { wrapper },
  );
  expect(fakeHost.preview.mount).not.toHaveBeenCalled();
});

it('mounts with localhost:<port> once status reaches running', async () => {
  const containerRef = { current: document.createElement('div') };
  const { rerender } = renderHook(
    (props: { status: string; port: number | null }) =>
      usePreviewLifecycle({
        status: props.status as Parameters<typeof usePreviewLifecycle>[0]['status'],
        port: props.port,
        containerRef,
        projectId: 'p1',
        device: 'desktop',
      }),
    { initialProps: { status: 'starting', port: null as number | null }, wrapper },
  );
  await act(async () => {
    rerender({ status: 'running', port: 3000 });
  });
  expect(fakeHost.preview.mount).toHaveBeenCalledWith(
    containerRef.current,
    'http://localhost:3000',
    expect.objectContaining({ projectId: 'p1' }),
  );
});

it('destroys on unmount', async () => {
  const containerRef = { current: document.createElement('div') };
  const { unmount } = renderHook(
    () => usePreviewLifecycle({ status: 'running', port: 3000, containerRef, projectId: 'p1', device: 'desktop' }),
    { wrapper },
  );
  await act(async () => {});
  unmount();
  expect(fakeHandle.destroy).toHaveBeenCalled();
});

it('calls handle.destroy when status transitions from running to stopped', async () => {
  const containerRef = { current: document.createElement('div') };
  const { rerender } = renderHook(
    (props: { status: string; port: number | null }) =>
      usePreviewLifecycle({
        status: props.status as Parameters<typeof usePreviewLifecycle>[0]['status'],
        port: props.port,
        containerRef,
        projectId: 'p1',
        device: 'desktop',
      }),
    { initialProps: { status: 'running', port: 3000 as number | null }, wrapper },
  );
  await act(async () => {});
  vi.mocked(fakeHandle.destroy).mockReset();
  await act(async () => {
    rerender({ status: 'stopped', port: null });
  });
  expect(fakeHandle.destroy).toHaveBeenCalled();
});
