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
 *     (56) and the sidebar sit under this bar, so the 1px rule at the end of
 *     this section lands on the sidebar's right edge. Collapsed, it is 0 wide.
 *   [chat column] — the session tabs, then search and surface toggles.
 *     Collapsed, the show-sidebar button anchors to its left edge.
 *
 * Only the Chats view fills it: in Tasks / Automations / Setup Advisor /
 * Settings the bar keeps just the lights, the drag region and (collapsed) the
 * show-sidebar button.
 */
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { useSidebar } from '@/components/ui/sidebar';
import { SessionTabs } from '@/features/session-tabs/SessionTabs';
import { useUiPrefs } from '@/store/ui-prefs';
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
  // Outside Chats the bar is bare window chrome (Codex-style): the tabs, the
  // chat actions belong to the chat surface.
  const chats = useUiPrefs((s) => s.sidebarView) === 'chats';

  return (
    <div data-testid="title-bar" data-drag-region className="flex h-12 shrink-0 items-center bg-sidebar">
      <div aria-hidden className="shrink-0" style={{ width: TRAFFIC_LIGHTS_WIDTH }} />

      <div
        data-testid="title-bar-sidebar-section"
        data-collapsed={open ? undefined : ''}
        className="flex h-full shrink-0 items-center justify-end overflow-hidden"
        style={{ width: open ? SIDEBAR_SECTION_WIDTH : 0 }}
      >
        {open && chats && <span aria-hidden className="h-[18px] w-px shrink-0 bg-border" />}
      </div>

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
          </>
        )}
        {chats && <SessionTabs />}
        {chats && <TitleBarActions />}
      </div>
    </div>
  );
}
