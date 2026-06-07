/**
 * AppShell — the runnable application under a live daemon connection.
 *
 * Mounts exactly one runtime: DaemonPortProvider (synchronous port for the
 * runtime layer) → AssistantRuntimeProvider fed by useSessionsThreadList().
 * Everything under it — sidebar, chat surface, the single archive-dialog
 * outlet, the tag-popover host — shares that one runtime + port.
 *
 * useSessionListRouter() runs INSIDE the provider so it can reach the live
 * thread list (WS reload, unread, cross-project filter clear, archived-active
 * fallback). useSessionsThreadList() calls useDaemonPort(), so the provider
 * MUST wrap it — hence DaemonPortProvider is the outermost node here.
 */
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useSessionsThreadList } from '../features/sessions/runtime/use-sessions-thread-list';
import { useSessionListRouter } from '../features/sessions/ws/use-session-list-router';
import { SessionSidebar } from '../features/sessions/sidebar/SessionSidebar';
import { ArchiveWorktreeDialog } from '../features/sessions/sidebar/ArchiveWorktreeDialog';
import { TagPopoverHost } from '../features/sessions/tags/TagPopoverHost';
import { ChatSurface } from '../features/sessions/new-thread/ChatSurface';

function RuntimeBody({ port }: { port: number }) {
  useSessionListRouter();

  return (
    <div className="flex flex-1 overflow-hidden pt-10">
      <SessionSidebar />

      <main data-testid="chat-thread-area" className="relative flex flex-1 flex-col overflow-hidden">
        <ChatSurface port={port} />
      </main>

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
