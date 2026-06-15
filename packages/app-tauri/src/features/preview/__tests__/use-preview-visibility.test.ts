import { it, expect, vi, beforeEach } from 'vitest';

const previewSetVisible = vi.fn();
vi.mock('@/lib/tauri/preview', () => ({
  previewSetVisible: (...a: unknown[]) => previewSetVisible(...a),
}));

import { computePreviewVisible } from '../use-preview-visibility';

beforeEach(() => previewSetVisible.mockReset().mockResolvedValue(undefined));

it('hidden when the tab is not the active pane tab', () => {
  expect(computePreviewVisible({ isActiveTab: false, surfaceVisible: true, overlayMounted: false })).toBe(false);
});
it('hidden when an overlay/modal is mounted over it', () => {
  expect(computePreviewVisible({ isActiveTab: true, surfaceVisible: true, overlayMounted: true })).toBe(false);
});
it('hidden when the Run surface is not visible', () => {
  expect(computePreviewVisible({ isActiveTab: true, surfaceVisible: false, overlayMounted: false })).toBe(false);
});
it('visible only when active + surface-visible + no overlay', () => {
  expect(computePreviewVisible({ isActiveTab: true, surfaceVisible: true, overlayMounted: false })).toBe(true);
});
