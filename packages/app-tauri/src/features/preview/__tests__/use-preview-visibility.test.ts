import { it, expect, vi, beforeEach } from 'vitest';

const previewSetVisible = vi.fn();
vi.mock('@/lib/tauri/preview', () => ({
  previewSetVisible: (...a: unknown[]) => previewSetVisible(...a),
}));

import { computePreviewVisible } from '../use-preview-visibility';

beforeEach(() => previewSetVisible.mockReset().mockResolvedValue(undefined));

const base = { isActiveTab: true, surfaceVisible: true, overlayMounted: false, occluded: false };

it('hidden when the tab is not the active pane tab', () => {
  expect(computePreviewVisible({ ...base, isActiveTab: false })).toBe(false);
});
it('hidden when an overlay/modal is mounted over it', () => {
  expect(computePreviewVisible({ ...base, overlayMounted: true })).toBe(false);
});
it('hidden when the Run surface is not visible', () => {
  expect(computePreviewVisible({ ...base, surfaceVisible: false })).toBe(false);
});
it('hidden when a DOM overlay overlaps it (occluded)', () => {
  expect(computePreviewVisible({ ...base, occluded: true })).toBe(false);
});
it('visible only when active + surface-visible + no overlay + not occluded', () => {
  expect(computePreviewVisible(base)).toBe(true);
});
