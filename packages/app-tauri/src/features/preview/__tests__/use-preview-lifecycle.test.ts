import { it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const previewCreate = vi.fn();
const previewNavigate = vi.fn();
const previewDestroy = vi.fn();
const previewSetVisible = vi.fn();
vi.mock('@/lib/tauri/preview', () => ({
  previewCreate: (...a: unknown[]) => previewCreate(...a),
  previewNavigate: (...a: unknown[]) => previewNavigate(...a),
  previewDestroy: (...a: unknown[]) => previewDestroy(...a),
  previewSetVisible: (...a: unknown[]) => previewSetVisible(...a),
}));

import { usePreviewLifecycle } from '../use-preview-lifecycle';

beforeEach(() => {
  previewCreate.mockReset().mockResolvedValue(undefined);
  previewNavigate.mockReset().mockResolvedValue(undefined);
  previewDestroy.mockReset().mockResolvedValue(undefined);
  previewSetVisible.mockReset().mockResolvedValue(undefined);
});

it('does NOT create before status is running (port-readiness gating)', () => {
  const ref = { current: document.createElement('div') };
  renderHook(() => usePreviewLifecycle({ tabId: 't1', status: 'starting', port: null, anchorRef: ref }));
  expect(previewCreate).not.toHaveBeenCalled();
});

it('creates with localhost:<port> once status reaches running', async () => {
  const ref = { current: document.createElement('div') };
  const { rerender } = renderHook(
    (props: { status: string; port: number | null }) =>
      usePreviewLifecycle({ tabId: 't1', status: props.status as any, port: props.port, anchorRef: ref }),
    { initialProps: { status: 'starting', port: null as number | null } },
  );
  await act(async () => {
    rerender({ status: 'running', port: 3000 });
  });
  expect(previewCreate).toHaveBeenCalledWith('t1', 'http://localhost:3000', expect.any(Object));
});

it('destroys on unmount', async () => {
  const ref = { current: document.createElement('div') };
  const { unmount } = renderHook(() =>
    usePreviewLifecycle({ tabId: 't1', status: 'running', port: 3000, anchorRef: ref }),
  );
  await act(async () => {});
  unmount();
  expect(previewDestroy).toHaveBeenCalledWith('t1');
});

it('calls previewDestroy when status transitions from running to stopped', async () => {
  const ref = { current: document.createElement('div') };
  const { rerender } = renderHook(
    (props: { status: string; port: number | null }) =>
      usePreviewLifecycle({ tabId: 't1', status: props.status as any, port: props.port, anchorRef: ref }),
    { initialProps: { status: 'running', port: 3000 as number | null } },
  );
  await act(async () => {});
  previewDestroy.mockReset().mockResolvedValue(undefined);
  await act(async () => {
    rerender({ status: 'stopped', port: null });
  });
  expect(previewDestroy).toHaveBeenCalledWith('t1');
});
