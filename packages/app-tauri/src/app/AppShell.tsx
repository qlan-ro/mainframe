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
    <div className="flex flex-1 gap-2 overflow-hidden bg-mf-window p-2">
      {/* Floating panels (prototype 04-engine root: padding + gap). Both the
          sidebar and the main surface area inset equally from the window edge;
          the native traffic lights are positioned (trafficLightPosition) to land
          centered inside the floating SidebarHeader. */}
      {sidebarVisible && (
        <div className="flex flex-shrink-0">
          <SidebarShell />
        </div>
      )}

      <div className="relative flex flex-1 flex-col overflow-hidden">
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
