import type { KeyboardEventHandler, PointerEventHandler } from 'react';
import { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_EXPANDED_WIDTH } from './SidebarShell';

interface SidebarCollapseHandleProps {
  collapsed: boolean;
  left: number;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  width: number;
}

export function SidebarCollapseHandle({
  collapsed,
  left,
  onKeyDown,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  width,
}: SidebarCollapseHandleProps) {
  return (
    <div
      data-testid="sidebar-collapse-handle"
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_COLLAPSED_WIDTH}
      aria-valuemax={SIDEBAR_EXPANDED_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className="group absolute top-0 z-20 flex h-full w-2.5 cursor-ew-resize touch-none select-none items-center justify-center"
      style={{ left }}
    >
      <span
        data-testid="sidebar-collapse-indicator"
        aria-hidden="true"
        className="h-6 w-1 rounded-full bg-mf-text-4 opacity-70 transition-[background-color,opacity] group-hover:bg-mf-text-3 group-hover:opacity-100"
      />
    </div>
  );
}
