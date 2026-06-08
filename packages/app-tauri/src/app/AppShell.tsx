/**
 * AppShell — the runnable application under a live daemon connection.
 *
 * DaemonPortProvider → AssistantRuntimeProvider feed the sidebar + surface host.
 * useSessionListRouter() runs INSIDE the provider (needs the live thread list).
 */
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { PanelLeft } from 'lucide-react';
import { ArchiveWorktreeDialog } from '../features/sessions/sidebar/ArchiveWorktreeDialog';
import { TagPopoverHost } from '../features/sessions/tags/TagPopoverHost';
import { useSessionsThreadList } from '../features/sessions/runtime/use-sessions-thread-list';
import { useSessionListRouter } from '../features/sessions/ws/use-session-list-router';
import { useLayoutStore } from '../store/layout';
import { SidebarCollapseHandle } from '../layout/SidebarCollapseHandle';
import { SIDEBAR_EXPANDED_WIDTH, SidebarShell } from '../layout/SidebarShell';
import { SurfaceHost } from '../layout/SurfaceHost';
import { TRAFFIC_LIGHTS_SPACER_WIDTH } from '../layout/SidebarHeader';
import { useSidebarResize } from '../layout/useSidebarResize';

function ShowSidebarButton({ left, onClick }: { left: number; onClick: () => void }) {
  return (
    <button
      data-testid="show-sidebar-button"
      type="button"
      title="Show sidebar"
      onClick={onClick}
      className="absolute top-2 z-10 inline-flex h-[22px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-none bg-transparent hover:bg-accent"
      style={{ left }}
    >
      <PanelLeft size={14} className="text-muted-foreground" />
    </button>
  );
}

// Collapsed-state chrome geometry. When the sidebar isn't rendered, the
// show-sidebar button lives in the surface's leading inset, just past the native
// traffic lights — so the surface chrome must clear BOTH the lights and the
// button (otherwise the header content lands on top of them). Tunable: bump the
// +12 gap for more breathing room between the lights and the button.
export const SHOW_SIDEBAR_BUTTON_LEFT = TRAFFIC_LIGHTS_SPACER_WIDTH + 12;
const SHOW_SIDEBAR_BUTTON_WIDTH = 26;
export const COLLAPSED_CHROME_INSET = SHOW_SIDEBAR_BUTTON_LEFT + SHOW_SIDEBAR_BUTTON_WIDTH + 8;

function getMainChromeInset(sidebarRendered: boolean, sidebarWidth: number): number {
  if (!sidebarRendered) return COLLAPSED_CHROME_INSET;
  return Math.max(0, TRAFFIC_LIGHTS_SPACER_WIDTH - sidebarWidth);
}

function getMainOverlap(sidebarRendered: boolean, sidebarWidth: number): number {
  if (!sidebarRendered) return 0;
  return Math.max(0, SIDEBAR_EXPANDED_WIDTH - sidebarWidth);
}

function RuntimeBody({ port }: { port: number }) {
  useSessionListRouter();
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const {
    dragCollapsed,
    dragging,
    expand,
    finishDrag,
    handleKeyDown,
    handlePointerDown,
    handlePointerMove,
    sidebarWidth,
    willCollapse,
  } = useSidebarResize(sidebarVisible);

  const sidebarRendered = sidebarVisible && !dragCollapsed;
  // One-click expand from either collapsed state: a drag-collapse leaves the
  // sidebar "visible" but dragCollapsed, so clear that; a button-hide flips
  // sidebarVisible back on (the hook resets dragCollapsed on that transition).
  const expandSidebar = () => {
    if (sidebarVisible) expand();
    else toggleSidebar();
  };
  const mainChromeInset = getMainChromeInset(sidebarRendered, sidebarWidth);
  const mainOverlap = getMainOverlap(sidebarRendered, sidebarWidth);

  return (
    <div className="flex flex-1 gap-2 overflow-hidden bg-mf-window p-2">
      {/* Floating panels (prototype 04-engine root: padding + gap). Both the
          sidebar and the main surface area inset equally from the window edge;
          the native traffic lights are positioned (trafficLightPosition) to land
          centered inside the floating SidebarHeader. */}
      {sidebarRendered && (
        <div className="flex flex-shrink-0">
          <SidebarShell
            dimmed={willCollapse}
            dragging={dragging}
            width={Math.max(SIDEBAR_EXPANDED_WIDTH, sidebarWidth)}
          />
        </div>
      )}

      <div
        data-testid="main-surface-shell"
        className="relative flex flex-1 flex-col overflow-hidden"
        style={{ marginLeft: mainOverlap > 0 ? -mainOverlap : undefined }}
      >
        {sidebarVisible && (
          <SidebarCollapseHandle
            collapsed={dragCollapsed}
            left={0}
            onKeyDown={handleKeyDown}
            onPointerCancel={finishDrag}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrag}
            width={sidebarWidth}
          />
        )}
        {/* Show-sidebar trigger — shown whenever the sidebar isn't rendered,
            i.e. both button-hidden AND drag-collapsed. */}
        {!sidebarRendered && <ShowSidebarButton left={SHOW_SIDEBAR_BUTTON_LEFT} onClick={expandSidebar} />}
        <SurfaceHost mainChromeInset={mainChromeInset} port={port} />
      </div>

      {/* Single app-wide outlets driven by their bridges/stores */}
      <ArchiveWorktreeDialog />
      <TagPopoverHost port={port} />
    </div>
  );
}

export function AppShell({ port }: { port: number }) {
  const runtime = useSessionsThreadList();

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <RuntimeBody port={port} />
    </AssistantRuntimeProvider>
  );
}
