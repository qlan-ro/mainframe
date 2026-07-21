// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PreviewHandle } from '@qlan-ro/mainframe-types';
import { useLayoutStore } from '@/store/layout';

import { computePreviewVisible, usePreviewVisibility } from '../use-preview-visibility';

// compositesAboveDom:true preserves the original Tauri expectations
const base = {
  isActiveTab: true,
  surfaceVisible: true,
  overlayMounted: false,
  occluded: false,
  compositesAboveDom: true,
};

it.each([
  ['isActiveTab is false', { isActiveTab: false }],
  ['overlayMounted is true', { overlayMounted: true }],
  ['surfaceVisible is false', { surfaceVisible: false }],
  ['occluded is true', { occluded: true }],
] as const)('hidden when %s', (_label, override) => {
  expect(computePreviewVisible({ ...base, ...override })).toBe(false);
});
it('visible only when active + surface-visible + no overlay + not occluded', () => {
  expect(computePreviewVisible(base)).toBe(true);
});

// --- compositesAboveDom gating ---

it.each([
  [
    'overlayMounted, compositesAboveDom=false (Electron) → not hidden',
    { isActiveTab: true, surfaceVisible: true, overlayMounted: true, occluded: false, compositesAboveDom: false },
    true,
  ],
  [
    'occluded, compositesAboveDom=false (Electron) → not hidden',
    { isActiveTab: true, surfaceVisible: true, overlayMounted: false, occluded: true, compositesAboveDom: false },
    true,
  ],
  [
    'overlayMounted, compositesAboveDom=true (Tauri) → hidden',
    { isActiveTab: true, surfaceVisible: true, overlayMounted: true, occluded: false, compositesAboveDom: true },
    false,
  ],
  [
    'occluded, compositesAboveDom=true (Tauri) → hidden',
    { isActiveTab: true, surfaceVisible: true, overlayMounted: false, occluded: true, compositesAboveDom: true },
    false,
  ],
  [
    'inactive tab still hides regardless of compositesAboveDom',
    { isActiveTab: false, surfaceVisible: true, overlayMounted: false, occluded: false, compositesAboveDom: false },
    false,
  ],
  [
    'hidden surface still hides regardless of compositesAboveDom',
    { isActiveTab: true, surfaceVisible: false, overlayMounted: false, occluded: false, compositesAboveDom: false },
    false,
  ],
] as const)('%s', (_label, input, expected) => {
  expect(computePreviewVisible(input)).toBe(expected);
});

// --- usePreviewVisibility: handle-swap re-assertion (regression) ---

function makeFakeHandle(): PreviewHandle {
  return {
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
}

it('re-asserts setVisible(false) on a new handle even when the computed value is unchanged (recreated webview desync)', () => {
  useLayoutStore.setState({
    layout: { top: ['run'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
    run: null,
    sessions: new Map(),
    activeSessionId: null,
  });

  const handleA = makeFakeHandle();
  const { rerender } = renderHook(
    (props: { handle: PreviewHandle; occluded: boolean }) => usePreviewVisibility(props.handle, true, props.occluded),
    { initialProps: { handle: handleA, occluded: true } },
  );
  act(() => {});
  expect(handleA.setVisible).toHaveBeenCalledWith(false);

  const handleB = makeFakeHandle();
  act(() => {
    rerender({ handle: handleB, occluded: true });
  });
  expect(handleB.setVisible).toHaveBeenCalledWith(false);
});
