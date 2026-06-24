import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import { useHost } from '@/lib/host';
import { useLayoutStore } from '@/store/layout';
import { useUiPrefs } from '@/store/ui-prefs';

interface PreviewGeometryProps {
  tabId: string;
  /** The inner frame the webview should exactly cover (present only when running). */
  anchorRef: RefObject<HTMLDivElement | null>;
  /**
   * The always-present body wrapper (`flex-1`) above the console drawer. Observed
   * for size changes so the webview re-fits when the console drawer is resized or
   * expanded — flex shrinks THIS element directly, whereas the absolute-positioned
   * anchor (desktop) or fixed-size phone frame (mobile) is a less reliable signal.
   */
  containerRef: RefObject<HTMLDivElement | null>;
  active: boolean;
  /** Re-attach the observer when the anchor (un)mounts on a status transition. */
  status: LaunchProcessStatus | null;
}

export function usePreviewGeometry({ tabId, anchorRef, containerRef, active, status }: PreviewGeometryProps): void {
  const host = useHost();
  const rafRef = useRef<number | null>(null);

  function scheduleBoundsUpdate() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      // Prefer the precise inner frame; fall back to the body wrapper before it mounts.
      const el = anchorRef.current ?? containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      host.preview
        .setBounds(tabId, { x: r.left, y: r.top, w: r.width, h: r.height })
        .catch((e) => console.warn('[preview] geometry set-bounds', e));
    });
  }

  const topFlex = useLayoutStore((s) => s.layout.topFlex);
  const vFlex = useLayoutStore((s) => s.layout.vFlex);
  const sidebarVisible = useUiPrefs((s) => s.sidebarVisible);
  const inspectorVisible = useUiPrefs((s) => s.inspectorVisible);

  useEffect(() => {
    scheduleBoundsUpdate();
  }, [topFlex, vFlex, sidebarVisible, inspectorVisible]);

  useEffect(() => {
    if (active) scheduleBoundsUpdate();
  }, [active]);

  useEffect(() => {
    const observer = new ResizeObserver(() => scheduleBoundsUpdate());
    // The body wrapper is always present and is what flex shrinks when the console
    // grows; the anchor is observed too (when mounted) for precise per-frame fit.
    if (containerRef.current) observer.observe(containerRef.current);
    if (anchorRef.current) observer.observe(anchorRef.current);
    scheduleBoundsUpdate();
    return () => {
      observer.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [tabId, anchorRef, containerRef, status]);
}
