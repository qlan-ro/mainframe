/**
 * PROTOTYPE — remove with features/workspace-proto.
 *
 * The Files tree as a LOCAL sidebar inside the workspace surface (left of the
 * pane row, inside the surface card), instead of today's app-level right
 * InspectorPane. Uses the real FileTree against the live daemon, so opening a
 * file from it exercises the real open-file intent path.
 *
 * Collapse is session-local state (no ui-prefs write for a prototype). The
 * collapsed form is a thin rail with one re-open button — the same idiom the
 * session panel established on the chat side.
 */
import { useState } from 'react';
import { FolderTree, PanelLeftClose } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { Hint } from '@v2/components/ui/hint';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { FileTree } from '@/features/files/FileTree';

export function WorkspaceFilesSidebar() {
  const port = useDaemonPort();
  const { projectId, chatId } = useActiveIdentity();
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div
        data-testid="proto-files-rail"
        className="flex w-9 shrink-0 flex-col items-center border-r border-border pt-1.5"
      >
        <Hint label="Show files">
          <Button
            data-testid="proto-files-expand"
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
    <div data-testid="proto-files-sidebar" className="flex w-60 shrink-0 flex-col border-r border-border">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border pr-1 pl-3">
        <span className="text-xs font-medium text-muted-foreground">Files</span>
        <Hint label="Collapse files">
          <Button
            data-testid="proto-files-collapse"
            variant="ghost"
            size="icon-xs"
            onClick={() => setCollapsed(true)}
            className="text-muted-foreground"
          >
            <PanelLeftClose />
          </Button>
        </Hint>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {!projectId ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">Open a session to browse its files.</div>
        ) : (
          <FileTree port={port} projectId={projectId} chatId={chatId} />
        )}
      </div>
    </div>
  );
}
