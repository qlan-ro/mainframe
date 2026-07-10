import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { LaunchProcessStatus, PreviewHandle } from '@qlan-ro/mainframe-types';
import { useLayoutStore } from '@/store/layout';
import { useUiPrefs } from '@/store/ui-prefs';
import { useTheme } from '@/store/theme';

interface PreviewGeometryProps {
  handle: PreviewHandle | null;
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

export function usePreviewGeometry({ handle, anchorRef, containerRef, active, status }: PreviewGeometryProps): void {
  const rafRef = useRef<number | null>(null);

  function scheduleRefit() {
    if (!handle) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      handle.refit();
    });
  }

  const topFlex = useLayoutStore((s) => s.layout.topFlex);
  const vFlex = useLayoutStore((s) => s.layout.vFlex);
  const sidebarVisible = useUiPrefs((s) => s.sidebarVisible);
  const inspectorVisible = useUiPrefs((s) => s.inspectorVisible);
  // UI page-zoom changes the native-webview bounds multiplier but NOT the CSS
  // layout, so the ResizeObserver never fires — refit explicitly on scale change.
  const uiScale = useTheme((s) => s.uiScale);

  useEffect(() => {
    scheduleRefit();
  }, [topFlex, vFlex, sidebarVisible, inspectorVisible, uiScale, handle]);

  useEffect(() => {
    if (active) scheduleRefit();
  }, [active, handle]);

  useEffect(() => {
    const observer = new ResizeObserver(() => scheduleRefit());
    if (containerRef.current) observer.observe(containerRef.current);
    if (anchorRef.current) observer.observe(anchorRef.current);
    // A window resize can REPOSITION the panel without changing the anchor's
    // size (the flex delta absorbed elsewhere) — the ResizeObserver never fires
    // and the native webview stays glued at its old window-relative rect.
    const onWindowResize = () => scheduleRefit();
    window.addEventListener('resize', onWindowResize);
    scheduleRefit();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onWindowResize);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [anchorRef, containerRef, status, handle]);
}
