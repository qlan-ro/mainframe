/**
 * WorkspaceFilesSidebar — the project file tree as a LOCAL sidebar on the
 * workspace surface's RIGHT edge (the successor of the app-level InspectorPane,
 * per docs/plans/2026-08-08-session-tabs-and-workspace-files.md).
 *
 * No header row of its own: the tree's project-name/refresh row is the header,
 * and the collapse control renders next to Refresh via FileTree's `onCollapse`.
 * Collapsed = a thin rail with one re-open button (the idiom the session panel
 * established on the chat side). State persists in ui-prefs
 * (`workspaceFilesCollapsed`); expanding from anywhere else (toolbar toggle,
 * reveal-file intent) goes through the same flag.
 */
import { FolderTree } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { Hint } from '@v2/components/ui/hint';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useUiPrefs } from '@/store/ui-prefs';
import { FileTree } from './FileTree';

export function WorkspaceFilesSidebar() {
  const port = useDaemonPort();
  const { projectId, chatId } = useActiveIdentity();
  const collapsed = useUiPrefs((s) => s.workspaceFilesCollapsed);
  const setCollapsed = useUiPrefs((s) => s.setWorkspaceFilesCollapsed);

  if (collapsed) {
    return (
      <div
        data-testid="workspace-files-rail"
        className="flex w-9 shrink-0 flex-col items-center border-l border-border pt-1.5"
      >
        <Hint label="Show files">
          <Button
            data-testid="workspace-files-expand"
            variant="ghost"
            size="icon-xs"
            onClick={() => setCollapsed(false)}
            className="text-muted-foreground"
          >
            <FolderTree />
          </Button>
        </Hint>
      </div>
    );
  }

  return (
    <div data-testid="workspace-files-sidebar" className="flex w-60 shrink-0 flex-col border-l border-border">
      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {!projectId ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">Open a session to browse its files.</div>
        ) : (
          <FileTree port={port} projectId={projectId} chatId={chatId} onCollapse={() => setCollapsed(true)} />
        )}
      </div>
    </div>
  );
}
