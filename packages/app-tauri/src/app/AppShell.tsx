/**
 * AppShell — the runnable application under a live daemon connection.
 *
 * DaemonPortProvider → AssistantRuntimeProvider feed the sidebar + surface host.
 * useSessionListRouter() runs INSIDE the provider (needs the live thread list).
 */
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { ArchiveWorktreeDialog } from '../features/sessions/sidebar/ArchiveWorktreeDialog';
import { TagPopoverHost } from '../features/sessions/tags/TagPopoverHost';
import { useSessionsThreadList } from '../features/sessions/runtime/use-sessions-thread-list';
import { useSessionListRouter } from '../features/sessions/ws/use-session-list-router';
import { useActiveIdentity } from '../features/sessions/use-active-identity';
import { useLayoutStore } from '../store/layout';
import { MainToolbar } from '../layout/MainToolbar';
import { SidebarCollapseHandle } from '../layout/SidebarCollapseHandle';
import { SIDEBAR_EXPANDED_WIDTH, SidebarShell } from '../layout/SidebarShell';
import { SurfaceHost } from '../layout/SurfaceHost';
import { TRAFFIC_LIGHTS_SPACER_WIDTH } from '../layout/SidebarHeader';
import { useSidebarResize } from '../layout/useSidebarResize';

/** While the sidebar is collapsed, the surface area's top-left sits under the
 *  native traffic lights, so the MainToolbar's left group insets to clear them. */
function getLeadingInset(sidebarRendered: boolean, sidebarWidth: number): number {
  if (!sidebarRendered) return TRAFFIC_LIGHTS_SPACER_WIDTH;
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
  const { projectName, branchName } = useActiveIdentity();
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
  const leadingInset = getLeadingInset(sidebarRendered, sidebarWidth);
  const mainOverlap = getMainOverlap(sidebarRendered, sidebarWidth);

  return (
    <div className="flex flex-1 gap-2 overflow-hidden bg-mf-window p-2">
      {/* Floating panels (prototype 04-engine root: padding + gap). The native
          traffic lights stay over the sidebar header; when collapsed, the
          MainToolbar's left group insets to clear them. */}
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
        <MainToolbar
          leadingInset={leadingInset}
          sidebarRendered={sidebarRendered}
          onExpandSidebar={expandSidebar}
          projectName={projectName}
          branchName={branchName}
        />
        <SurfaceHost port={port} />
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
