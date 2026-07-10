import { it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PreviewHandle } from '@qlan-ro/mainframe-types';

import { usePreviewGeometry } from '../use-preview-geometry';

let handle: PreviewHandle;

beforeEach(() => {
  handle = {
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
});

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

function refs() {
  const anchor = document.createElement('div');
  const container = document.createElement('div');
  document.body.append(anchor, container);
  return {
    anchorRef: { current: anchor as HTMLDivElement | null },
    containerRef: { current: container as HTMLDivElement | null },
  };
}

it('refits on window resize (position-only shifts never fire the ResizeObserver)', async () => {
  const { anchorRef, containerRef } = refs();
  renderHook(() => usePreviewGeometry({ handle, anchorRef, containerRef, active: true, status: 'running' }));
  await act(async () => {
    await nextFrame();
  });
  vi.mocked(handle.refit).mockClear();

  await act(async () => {
    window.dispatchEvent(new Event('resize'));
    await nextFrame();
  });
  expect(handle.refit).toHaveBeenCalled();
});

it('removes the resize listener on unmount', async () => {
  const { anchorRef, containerRef } = refs();
  const { unmount } = renderHook(() =>
    usePreviewGeometry({ handle, anchorRef, containerRef, active: true, status: 'running' }),
  );
  await act(async () => {
    await nextFrame();
  });
  unmount();
  vi.mocked(handle.refit).mockClear();

  window.dispatchEvent(new Event('resize'));
  await nextFrame();
  expect(handle.refit).not.toHaveBeenCalled();
});
