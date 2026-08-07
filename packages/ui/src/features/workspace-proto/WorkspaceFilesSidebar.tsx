/**
 * PROTOTYPE — remove with features/workspace-proto.
 *
 * The Files tree as a LOCAL sidebar on the workspace surface's RIGHT edge
 * (verdict rounds: right over left; no "Files" header row — the tree's own
 * project-name/refresh row is the header, and the collapse control sits next
 * to the refresh icon via FileTree's proto `headerExtra` slot). Real FileTree
 * against the live daemon, so opening a file exercises the real intent path.
 *
 * Collapse is session-local state (no ui-prefs write for a prototype). The
 * collapsed form is a thin rail with one re-open button — the same idiom the
 * session panel established on the chat side.
 */
import { useState } from 'react';
import { FolderTree, PanelRightClose } from 'lucide-react';
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
        className="flex w-9 shrink-0 flex-col items-center border-l border-border pt-1.5"
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

  // Matches FileTree's own hand-rolled 20px refresh button, so the pair reads
  // as one control cluster on the tree's header row.
  const collapseButton = (
    <Hint label="Collapse files">
      <button
        data-testid="proto-files-collapse"
        type="button"
        onClick={() => setCollapsed(true)}
        className="inline-flex h-[20px] w-[20px] flex-shrink-0 items-center justify-center rounded-[4px] border-none bg-transparent hover:bg-accent"
      >
        <PanelRightClose size={14} className="text-muted-foreground" />
      </button>
    </Hint>
  );

  return (
    <div data-testid="proto-files-sidebar" className="flex w-60 shrink-0 flex-col border-l border-border">
      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {!projectId ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">Open a session to browse its files.</div>
        ) : (
          <FileTree port={port} projectId={projectId} chatId={chatId} headerExtra={collapseButton} />
        )}
      </div>
    </div>
  );
}
