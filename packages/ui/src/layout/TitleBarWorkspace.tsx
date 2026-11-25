/**
 * TitleBarWorkspace — the title bar's workspace segment (W1, W2): the primary
 * pane's tabs, the `+`, then the Files toggle at the segment's right end (W3).
 * The panel below has no tab strip of its own.
 */
import { Folder } from 'lucide-react';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { isWorkspaceFilesPanelOpen, useWorkspaceFilesPanel } from '@/store/workspace-files-panel';
import { useScopedRun } from './surfaces/use-scoped-run';
import { TitleBarButton } from './TitleBarButton';
import { WorkspaceTabs } from './WorkspaceTabs';

function FilesToggle() {
  const scopeKey = useActiveBasesStore((s) => s.scopeKey);
  const open = useWorkspaceFilesPanel((s) => isWorkspaceFilesPanelOpen(s.openByScope, scopeKey));
  const setOpen = useWorkspaceFilesPanel((s) => s.setOpen);
  return (
    <TitleBarButton
      testId="workspace-files-open"
      label="Files"
      hint={open ? 'Hide files' : 'Show files'}
      on={open}
      className="size-7"
      onClick={() => setOpen(!open)}
    >
      <Folder className="size-4" />
    </TitleBarButton>
  );
}

export function TitleBarWorkspace() {
  const { run } = useScopedRun();
  const pane = run?.panes[0] ?? null;
  return (
    <div
      data-testid="title-bar-workspace"
      className="flex h-full min-w-0 flex-1 items-center pl-2 @max-[36rem]/trailing:pl-1"
    >
      {/* Remounted per pane so an open URL entry never carries over to another session's tabs. */}
      <WorkspaceTabs key={pane?.id ?? 'empty'} pane={pane} />
      <FilesToggle />
      {/* Plain div under the drag region: the empty part of the segment drags the window. */}
      <div className="h-full min-w-4 flex-1 @max-[32rem]/trailing:min-w-0" />
    </div>
  );
}
