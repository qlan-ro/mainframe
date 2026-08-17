/**
 * WorkspaceFilesPanel — the project file tree as a persistent DOCKED sidebar
 * on the right edge of the Workspace surface. `WorkspaceSurface` owns the
 * `SidebarProvider` so this panel and the content pane are flex siblings:
 * opening it shrinks the content pane, it never overlaps it.
 *
 * Reversal of the earlier floating/light-dismissed glass panel (see
 * packages/ui/CLAUDE.md, 2026-08-15, for the why). A docked sidebar has no
 * "outside" to light-dismiss into — it closes only via its own toggle
 * (WorkspaceStripChrome's Files button) or the tree's own collapse button.
 *
 * Built on the shared `Sidebar` primitive (`side="right"`,
 * `collapsible="offcanvas"`): collapsing animates width to 0 while keeping
 * the tree MOUNTED, so folder expansion and scroll position survive a close —
 * the same guarantee the old mounted-hidden trick gave, for free.
 *
 * `FileTree` owns its own fixed header / scrolling body split (via
 * `SidebarHeader` + `SidebarScrollRegion`) — this component just gives it a
 * non-scrolling `flex-1 min-h-0` slot to fill, so the tree's header row stays
 * pinned while only its rows scroll.
 *
 * data-testid: workspace-files-panel (present only while open).
 */
import { Sidebar } from '@/components/ui/sidebar';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { isWorkspaceFilesPanelOpen, useWorkspaceFilesPanel } from '@/store/workspace-files-panel';
import { FileTree } from './FileTree';

export function WorkspaceFilesPanel() {
  const port = useDaemonPort();
  const { projectId, chatId } = useActiveIdentity();
  const scopeKey = useActiveBasesStore((s) => s.scopeKey);
  const open = useWorkspaceFilesPanel((s) => isWorkspaceFilesPanelOpen(s.openByScope, scopeKey));
  const setOpen = useWorkspaceFilesPanel((s) => s.setOpen);

  return (
    <Sidebar side="right" collapsible="offcanvas">
      <div data-testid={open ? 'workspace-files-panel' : undefined} className="flex min-h-0 flex-1 flex-col">
        {!projectId ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">Open a session to browse its files.</div>
        ) : (
          <FileTree port={port} projectId={projectId} chatId={chatId} onCollapse={() => setOpen(false)} />
        )}
      </div>
    </Sidebar>
  );
}
