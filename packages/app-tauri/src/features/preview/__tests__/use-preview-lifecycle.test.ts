import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { HostProvider, setHostForTesting, resetHostForTesting } from '@/lib/host';

import { usePreviewLifecycle } from '../use-preview-lifecycle';

let fakeHost: FakeHostBridge;

beforeEach(() => {
  fakeHost = new FakeHostBridge();
  fakeHost.preview.create = vi.fn().mockResolvedValue(undefined);
  fakeHost.preview.navigate = vi.fn().mockResolvedValue(undefined);
  fakeHost.preview.destroy = vi.fn().mockResolvedValue(undefined);
  setHostForTesting(fakeHost);
});

afterEach(() => {
  resetHostForTesting();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(HostProvider, { host: fakeHost, children });
}

it('does NOT create before status is running (port-readiness gating)', () => {
  const ref = { current: document.createElement('div') };
  renderHook(() => usePreviewLifecycle({ tabId: 't1', status: 'starting', port: null, anchorRef: ref }), { wrapper });
  expect(fakeHost.preview.create).not.toHaveBeenCalled();
});

it('creates with localhost:<port> once status reaches running', async () => {
  const ref = { current: document.createElement('div') };
  const { rerender } = renderHook(
    (props: { status: string; port: number | null }) =>
      usePreviewLifecycle({ tabId: 't1', status: props.status as any, port: props.port, anchorRef: ref }),
    { initialProps: { status: 'starting', port: null as number | null }, wrapper },
  );
  await act(async () => {
    rerender({ status: 'running', port: 3000 });
  });
  expect(fakeHost.preview.create).toHaveBeenCalledWith('t1', 'http://localhost:3000', expect.any(Object));
});

it('destroys on unmount', async () => {
  const ref = { current: document.createElement('div') };
  const { unmount } = renderHook(
    () => usePreviewLifecycle({ tabId: 't1', status: 'running', port: 3000, anchorRef: ref }),
    { wrapper },
  );
  await act(async () => {});
  unmount();
  expect(fakeHost.preview.destroy).toHaveBeenCalledWith('t1');
});

it('calls preview.destroy when status transitions from running to stopped', async () => {
  const ref = { current: document.createElement('div') };
  const { rerender } = renderHook(
    (props: { status: string; port: number | null }) =>
      usePreviewLifecycle({ tabId: 't1', status: props.status as any, port: props.port, anchorRef: ref }),
    { initialProps: { status: 'running', port: 3000 as number | null }, wrapper },
  );
  await act(async () => {});
  vi.mocked(fakeHost.preview.destroy).mockReset().mockResolvedValue(undefined);
  await act(async () => {
    rerender({ status: 'stopped', port: null });
  });
  expect(fakeHost.preview.destroy).toHaveBeenCalledWith('t1');
});
