import { useEffect, useRef, useState } from 'react';
import type { PreviewHandle } from '@qlan-ro/mainframe-types';
import { useLayoutStore } from '@/store/layout';

interface ComputeVisibleInput {
  isActiveTab: boolean;
  surfaceVisible: boolean;
  overlayMounted: boolean;
  /** A DOM overlay (popover/menu/dialog) is overlapping the preview region. */
  occluded: boolean;
  /** Whether the webview composites above the DOM (only then do DOM overlays hide it). */
  compositesAboveDom: boolean;
}

export function computePreviewVisible({
  isActiveTab,
  surfaceVisible,
  overlayMounted,
  occluded,
  compositesAboveDom,
}: ComputeVisibleInput): boolean {
  const hiddenByOverlay = compositesAboveDom && (overlayMounted || occluded);
  return isActiveTab && surfaceVisible && !hiddenByOverlay;
}

/**
 * Drives the native webview's visibility from the React state, and returns
 * [overlayMounted, setOverlayMounted] — the seam the capture flow uses to hide
 * the webview behind its own overlays. `occluded` (from `usePreviewOcclusion`)
 * hides it when any DOM overlay overlaps it (the webview composites above DOM).
 */
export function usePreviewVisibility(
  handle: PreviewHandle | null,
  isActiveTab: boolean,
  occluded: boolean,
): [overlayMounted: boolean, setOverlayMounted: (v: boolean) => void] {
  const [overlayMounted, setOverlayMounted] = useState(false);
  const surfaceVisible = useLayoutStore((s) => {
    const { layout } = s;
    return (Array.isArray(layout.top) && layout.top.includes('run')) || layout.bottom === 'run';
  });
  const prevVisibleRef = useRef<boolean | null>(null);

  const compositesAboveDom = handle?.compositesAboveDom ?? false;

  useEffect(() => {
    const visible = computePreviewVisible({
      isActiveTab,
      surfaceVisible,
      overlayMounted,
      occluded,
      compositesAboveDom,
    });
    if (visible === prevVisibleRef.current) return;
    prevVisibleRef.current = visible;
    handle?.setVisible(visible);
  }, [handle, isActiveTab, surfaceVisible, overlayMounted, occluded, compositesAboveDom]);

  return [overlayMounted, setOverlayMounted];
}
