import { SessionSidebar } from '@/features/sessions/sidebar/SessionSidebar';
import { BottomPanel } from '@/features/context-panel/BottomPanel';
import { PanelResizeHandle } from '@/features/context-panel/PanelResizeHandle';
import { cn } from '@/lib/utils';
import type { WindowStyle } from '@/store/theme';
import { windowStyleGeometry } from '@/lib/appearance/window-style';
import { SidebarHeader } from './SidebarHeader';
import { SidebarFooter } from './SidebarFooter';

export const SIDEBAR_EXPANDED_WIDTH = 280;
export const SIDEBAR_COLLAPSED_WIDTH = 0;
export const SIDEBAR_COLLAPSE_THRESHOLD = 150;
/** Upper cap when dragging the sidebar wider than its natural width. */
export const SIDEBAR_MAX_WIDTH = 640;

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_COLLAPSED_WIDTH, width));
}

interface SidebarShellProps {
  dimmed?: boolean;
  dragging?: boolean;
  width?: number;
  windowStyle?: WindowStyle;
}

/** Glass-panel sidebar: chrome header + scrollable sessions content. */
export function SidebarShell({
  dimmed = false,
  dragging = false,
  width = SIDEBAR_EXPANDED_WIDTH,
  windowStyle = 'glass',
}: SidebarShellProps) {
  const geo = windowStyleGeometry(windowStyle);
  return (
    <div
      data-testid="sessions-sidebar"
      className={cn(
        'relative flex h-full flex-shrink-0 flex-col overflow-hidden font-sans text-foreground',
        geo.sidebar,
        dragging ? 'select-none transition-opacity duration-150' : 'transition-[width,opacity] duration-200 ease-out',
        // Dim while a release would collapse the panel — a "let go to close" cue.
        dimmed && 'opacity-30',
      )}
      style={{ width }}
    >
      <div
        data-testid="sessions-sidebar-content-frame"
        // min-h-0 is load-bearing: without it this flex item keeps its intrinsic
        // (content) height, so a tall session list overflows the sidebar instead
        // of letting the inner list scroll — pushing the bottom panel + footer
        // past the overflow-hidden clip and out of view.
        className="flex min-h-0 flex-1 flex-col @container"
        style={{ width, minWidth: SIDEBAR_EXPANDED_WIDTH }}
      >
        <SidebarHeader />
        <SessionSidebar />
        {/* Sidebar chrome below the session list — not part of the sessions feature. */}
        <PanelResizeHandle />
        <BottomPanel />
        <SidebarFooter />
      </div>
    </div>
  );
}
