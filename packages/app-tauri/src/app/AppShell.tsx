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
import { SidebarShell } from '../layout/SidebarShell';
import { SurfaceHost } from '../layout/SurfaceHost';

function RuntimeBody({ port }: { port: number }) {
  useSessionListRouter();

  return (
    <div className="flex flex-1 gap-2 overflow-hidden bg-mf-window p-2 pt-10">
      <SidebarShell />

      <SurfaceHost port={port} />

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
