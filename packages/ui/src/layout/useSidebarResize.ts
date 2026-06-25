import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  clampSidebarWidth,
  SIDEBAR_COLLAPSE_THRESHOLD,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
} from './SidebarShell';
import { useUiPrefs } from '@/store/ui-prefs';

interface ResizeDrag {
  startX: number;
  startWidth: number;
  currentWidth: number;
}

export function useSidebarResize(sidebarVisible: boolean) {
  const persistedWidth = useUiPrefs.getState().sidebarWidth;
  const [sidebarWidth, setSidebarWidth] = useState(persistedWidth);
  const [dragCollapsed, setDragCollapsed] = useState(persistedWidth === SIDEBAR_COLLAPSED_WIDTH);
  const firstRun = useRef(true);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<ResizeDrag | null>(null);

  useEffect(() => {
    // Honor the persisted width/collapsed state on initial mount; only react to
    // later show transitions (re-showing a hidden sidebar restores a usable width).
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (!sidebarVisible) return;
    const w = useUiPrefs.getState().sidebarWidth;
    const restored = w === SIDEBAR_COLLAPSED_WIDTH ? SIDEBAR_EXPANDED_WIDTH : w;
    setDragCollapsed(false);
    setSidebarWidth(restored);
  }, [sidebarVisible]);

  // Reset the global drag styles if we unmount mid-drag — finishDrag (pointerup)
  // never fires in that case, so the body would stay user-select:none/ew-resize.
  useEffect(
    () => () => {
      if (dragRef.current === null) return;
      document.body.style.removeProperty('user-select');
      document.body.style.removeProperty('cursor');
    },
    [],
  );

  const collapse = () => {
    setDragCollapsed(true);
    setSidebarWidth(SIDEBAR_COLLAPSED_WIDTH);
    useUiPrefs.getState().setSidebarWidth(SIDEBAR_COLLAPSED_WIDTH);
  };

  const expand = () => {
    setDragCollapsed(false);
    setSidebarWidth(SIDEBAR_EXPANDED_WIDTH);
    useUiPrefs.getState().setSidebarWidth(SIDEBAR_EXPANDED_WIDTH);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      collapse();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      expand();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (dragCollapsed) expand();
      else collapse();
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const startWidth = dragCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;
    dragRef.current = { startX: event.clientX, startWidth, currentWidth: startWidth };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null) return;
    const nextWidth = clampSidebarWidth(drag.startWidth + event.clientX - drag.startX);
    drag.currentWidth = nextWidth;
    setSidebarWidth(nextWidth);
    setDragCollapsed(nextWidth === SIDEBAR_COLLAPSED_WIDTH);
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    document.body.style.removeProperty('user-select');
    document.body.style.removeProperty('cursor');
    dragRef.current = null;
    setDragging(false);

    const nextCollapsed = drag.currentWidth < SIDEBAR_COLLAPSE_THRESHOLD;
    setDragCollapsed(nextCollapsed);
    const committed = nextCollapsed
      ? SIDEBAR_COLLAPSED_WIDTH
      : drag.currentWidth > SIDEBAR_EXPANDED_WIDTH
        ? clampSidebarWidth(drag.currentWidth)
        : SIDEBAR_EXPANDED_WIDTH;
    setSidebarWidth(committed);
    useUiPrefs.getState().setSidebarWidth(committed);
  };

  // While dragging, the sidebar will collapse on release once it's below the
  // threshold (mirrors finishDrag) — surface that so the panel can dim as a cue.
  const willCollapse = dragging && sidebarWidth < SIDEBAR_COLLAPSE_THRESHOLD;

  return {
    dragCollapsed,
    dragging,
    expand,
    finishDrag,
    handleKeyDown,
    handlePointerDown,
    handlePointerMove,
    sidebarWidth,
    willCollapse,
  };
}
