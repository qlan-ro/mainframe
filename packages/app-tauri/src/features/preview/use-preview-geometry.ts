import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { previewSetBounds } from '@/lib/tauri/preview';
import { useLayoutStore } from '@/store/layout';

interface PreviewGeometryProps {
  tabId: string;
  anchorRef: RefObject<HTMLDivElement | null>;
  active: boolean;
}

export function usePreviewGeometry({ tabId, anchorRef, active }: PreviewGeometryProps): void {
  const rafRef = useRef<number | null>(null);

  function scheduleBoundsUpdate() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      previewSetBounds(tabId, { x: r.left, y: r.top, w: r.width, h: r.height }).catch((e) =>
        console.warn('[preview] geometry set-bounds', e),
      );
    });
  }

  const topFlex = useLayoutStore((s) => s.layout.topFlex);
  const vFlex = useLayoutStore((s) => s.layout.vFlex);
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible);
  const inspectorVisible = useLayoutStore((s) => s.inspectorVisible);

  useEffect(() => {
    scheduleBoundsUpdate();
  }, [topFlex, vFlex, sidebarVisible, inspectorVisible]);

  useEffect(() => {
    if (active) scheduleBoundsUpdate();
  }, [active]);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => scheduleBoundsUpdate());
    observer.observe(el);
    scheduleBoundsUpdate();
    return () => {
      observer.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [tabId, anchorRef]);
}
