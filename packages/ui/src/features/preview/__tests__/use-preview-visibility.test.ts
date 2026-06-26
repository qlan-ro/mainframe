import { it, expect } from 'vitest';

import { computePreviewVisible } from '../use-preview-visibility';

// compositesAboveDom:true preserves the original Tauri expectations
const base = {
  isActiveTab: true,
  surfaceVisible: true,
  overlayMounted: false,
  occluded: false,
  compositesAboveDom: true,
};

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

// --- compositesAboveDom gating ---

it('does NOT hide for overlayMounted/occluded when compositesAboveDom is false (Electron)', () => {
  expect(
    computePreviewVisible({
      isActiveTab: true,
      surfaceVisible: true,
      overlayMounted: true,
      occluded: false,
      compositesAboveDom: false,
    }),
  ).toBe(true);
  expect(
    computePreviewVisible({
      isActiveTab: true,
      surfaceVisible: true,
      overlayMounted: false,
      occluded: true,
      compositesAboveDom: false,
    }),
  ).toBe(true);
});
it('hides for overlayMounted/occluded when compositesAboveDom is true (Tauri)', () => {
  expect(
    computePreviewVisible({
      isActiveTab: true,
      surfaceVisible: true,
      overlayMounted: true,
      occluded: false,
      compositesAboveDom: true,
    }),
  ).toBe(false);
  expect(
    computePreviewVisible({
      isActiveTab: true,
      surfaceVisible: true,
      overlayMounted: false,
      occluded: true,
      compositesAboveDom: true,
    }),
  ).toBe(false);
});
it('still hides when the tab is inactive or the surface is hidden, regardless of compositesAboveDom', () => {
  expect(
    computePreviewVisible({
      isActiveTab: false,
      surfaceVisible: true,
      overlayMounted: false,
      occluded: false,
      compositesAboveDom: false,
    }),
  ).toBe(false);
  expect(
    computePreviewVisible({
      isActiveTab: true,
      surfaceVisible: false,
      overlayMounted: false,
      occluded: false,
      compositesAboveDom: false,
    }),
  ).toBe(false);
});
