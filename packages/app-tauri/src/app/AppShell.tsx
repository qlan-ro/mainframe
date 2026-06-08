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
import { SidebarShell } from '../layout/SidebarShell';
import { SurfaceHost } from '../layout/SurfaceHost';

function RuntimeBody({ port }: { port: number }) {
  useSessionListRouter();
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);

  return (
    <div className="flex flex-1 overflow-hidden bg-mf-window">
      {/* Sidebar: pt-0 so SidebarShell is flush at y=0 — traffic lights sit inside
          the SidebarHeader (38px) with proper vertical breathing room. */}
      {sidebarVisible && (
        <div className="flex flex-shrink-0 px-2 pb-2">
          <SidebarShell />
        </div>
      )}

      {/* Main content: uniform p-2 — no extra top gap needed, traffic lights are
          confined to the sidebar column and never overlap the surface panels. */}
      <div className="relative flex flex-1 flex-col overflow-hidden p-2">
        {/* Show-sidebar trigger — visible only when sidebar is hidden. */}
        {!sidebarVisible && (
          <button
            data-testid="show-sidebar-button"
            type="button"
            title="Show sidebar"
            onClick={toggleSidebar}
            className="absolute left-2 top-2 z-10 inline-flex h-[22px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-none bg-transparent hover:bg-accent"
          >
            <PanelLeft size={14} className="text-muted-foreground" />
          </button>
        )}
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
