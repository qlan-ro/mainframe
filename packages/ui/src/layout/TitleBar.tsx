/**
 * TitleBar — the 48px strip across the top of the window, on the shell's
 * `sidebar` ground. It is the ONE window drag region (`data-drag-region`;
 * interactive children are excluded by the host's mousedown handler) and it
 * is in normal flow — nothing `fixed`.
 *
 * Three sections, left to right:
 *   [80px traffic lights] — the native cluster; `trafficLightPosition.y` is
 *     tuned to centre on this row (22 for SDK ≤ 15 builds, 26 patched for dev).
 *   [sidebar section] — `calc(56px + var(--sidebar-width) − 80px)`: the rail
 *     (56) and the sidebar sit under this bar, so the sidebar's right edge is
 *     at 56 + width and the 1px rule that ends this section lands on it. The
 *     surface toggle pill sits at its end. Collapsed, the section is 0 wide.
 *   [chat column] — the session tabs, then the right cluster. Collapsed, the
 *     show-sidebar button and the toggle pill re-anchor to its left edge.
 */
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { useSidebar } from '@/components/ui/sidebar';
import { SessionTabs } from '@/features/session-tabs/SessionTabs';
import { SurfaceRail } from './SurfaceRail';
import { TitleBarActions } from './TitleBarActions';
import { SidebarLeftGlyph } from './surface-icons';

/** The native traffic-light cluster: 3 buttons + gaps + the 20px inset, ≈72–80px. */
export const TRAFFIC_LIGHTS_WIDTH = 80;
/** `NavRail`'s width — the sidebar starts this far in. */
export const NAV_RAIL_WIDTH = 56;

/** The sidebar section's width while the sidebar is open: it ends on the sidebar's right edge. */
export const SIDEBAR_SECTION_WIDTH = `calc(${NAV_RAIL_WIDTH}px + var(--sidebar-width) - ${TRAFFIC_LIGHTS_WIDTH}px)`;

export function TitleBar() {
  const { open, setOpen } = useSidebar();

  return (
    <div data-testid="title-bar" data-drag-region className="flex h-12 shrink-0 items-center bg-sidebar">
      <div aria-hidden className="shrink-0" style={{ width: TRAFFIC_LIGHTS_WIDTH }} />

      <div
        data-testid="title-bar-sidebar-section"
        data-collapsed={open ? undefined : ''}
        className="flex h-full shrink-0 items-center justify-end overflow-hidden"
        style={{ width: open ? SIDEBAR_SECTION_WIDTH : 0 }}
      >
        {/* One pill instance at a time — it re-anchors to the chat column when collapsed. */}
        {open && (
          <>
            <SurfaceRail />
            {/* The rule marks where the sidebar ends under this bar. */}
            <span aria-hidden className="ml-2 h-[18px] w-px shrink-0 bg-border" />
          </>
        )}
      </div>

      {/* `pl-1` + the tab strip's own `px-1` = 8px from the rule to the first pill,
          matching the rule's `ml-2` from the surface toggle pill on its other side. */}
      <div data-testid="title-bar-chat-column" className="flex h-full min-w-0 flex-1 items-center gap-2 pr-3 pl-1">
        {!open && (
          <>
            <Hint label="Show sidebar">
              <Button
                data-testid="show-sidebar-button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setOpen(true)}
                className="text-muted-foreground"
              >
                <SidebarLeftGlyph size={16} />
              </Button>
            </Hint>
            <SurfaceRail />
          </>
        )}
        <SessionTabs />
        <TitleBarActions />
      </div>
    </div>
  );
}
