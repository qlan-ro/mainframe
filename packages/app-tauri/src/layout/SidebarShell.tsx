import { SessionSidebar } from '@/features/sessions/sidebar/SessionSidebar';
import { cn } from '@/lib/utils';
import { SidebarHeader } from './SidebarHeader';

export const SIDEBAR_EXPANDED_WIDTH = 300;
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
}

/** Glass-panel sidebar: chrome header + scrollable sessions content. */
export function SidebarShell({ dimmed = false, dragging = false, width = SIDEBAR_EXPANDED_WIDTH }: SidebarShellProps) {
  return (
    <div
      data-testid="sessions-sidebar"
      className={cn(
        'relative flex h-full flex-shrink-0 flex-col overflow-hidden rounded-[13px] bg-mf-glass font-sans text-foreground shadow-[var(--mf-shadow-panel-soft)] backdrop-blur-[40px] backdrop-saturate-[1.8]',
        dragging ? 'select-none transition-opacity duration-150' : 'transition-[width,opacity] duration-200 ease-out',
        // Dim while a release would collapse the panel — a "let go to close" cue.
        dimmed && 'opacity-30',
      )}
      style={{ width }}
    >
      <div
        data-testid="sessions-sidebar-content-frame"
        className="flex flex-1 flex-col @container"
        style={{ width, minWidth: SIDEBAR_EXPANDED_WIDTH }}
      >
        <SidebarHeader />
        <SessionSidebar />
      </div>
    </div>
  );
}
