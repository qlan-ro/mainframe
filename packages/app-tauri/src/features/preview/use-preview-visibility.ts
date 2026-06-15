import { useEffect, useRef, useState } from 'react';
import { previewSetVisible } from '@/lib/tauri/preview';
import { useLayoutStore } from '@/store/layout';

interface ComputeVisibleInput {
  isActiveTab: boolean;
  surfaceVisible: boolean;
  overlayMounted: boolean;
}

export function computePreviewVisible({ isActiveTab, surfaceVisible, overlayMounted }: ComputeVisibleInput): boolean {
  return isActiveTab && surfaceVisible && !overlayMounted;
}

/** Returns [overlayMounted, setOverlayMounted] — seam for Units D/E overlay tracking. */
export function usePreviewVisibility(
  tabId: string,
  isActiveTab: boolean,
): [overlayMounted: boolean, setOverlayMounted: (v: boolean) => void] {
  const [overlayMounted, setOverlayMounted] = useState(false);

  const surfaceVisible = useLayoutStore((s) => {
    const { layout } = s;
    return (Array.isArray(layout.top) && layout.top.includes('run')) || layout.bottom === 'run';
  });

  const prevVisibleRef = useRef<boolean | null>(null);

  useEffect(() => {
    const visible = computePreviewVisible({ isActiveTab, surfaceVisible, overlayMounted });
    if (visible === prevVisibleRef.current) return;
    prevVisibleRef.current = visible;
    previewSetVisible(tabId, visible).catch((e) => console.warn('[preview] visibility', e));
  }, [tabId, isActiveTab, surfaceVisible, overlayMounted]);

  return [overlayMounted, setOverlayMounted];
}
