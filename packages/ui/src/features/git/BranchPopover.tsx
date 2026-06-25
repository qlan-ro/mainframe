/**
 * BranchPopover — container + view routing for the branch management popover.
 *
 * The list and a selected branch's submenu render SIDE BY SIDE (the popover
 * grows to fit the adjacent submenu), matching the `13-popover` artboard — not a
 * drill-in that replaces the list. new-branch / rename / conflict remain
 * full-replace overlays.
 *
 * Branches are loaded LAZILY — only when `open` becomes true. The closed
 * popover never fires git fetches, so AppShell integration tests pass cleanly.
 *
 * Accepts `children` as the popover trigger (PopoverTrigger asChild), matching
 * the TagPopover pattern.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { sessionCustomOf } from '../sessions/view-model/chat-to-thread-custom';
import { useBranchActions } from './use-branch-actions';
import { useWorktreeSession } from './use-worktree-session';
import { BranchListView } from './BranchListView';
import { BranchSubmenu } from './BranchSubmenu';
import { NewBranchDialog } from './NewBranchDialog';
import { RenameBranchView } from './RenameBranchView';
import { ConflictView } from './ConflictView';
import type { BranchInfo } from '@qlan-ro/mainframe-types';

type View = 'list' | 'new-branch' | 'conflict' | 'rename';

const DEFAULT_ADAPTER_ID = 'claude';

// Each panel (list, submenu, overlay) is its own card; the popover container is
// bare so the list + submenu read as two separate cards with a gap (13-popover
// artboard), not one merged surface.
const PANEL_CARD = 'rounded-[11px] border border-border bg-popover p-[5px] shadow-[var(--mf-shadow-pop)]';

export interface BranchPopoverProps {
  port: number;
  projectId: string;
  chatId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBranchChanged?: () => void;
  children?: React.ReactNode;
}

interface SelectedBranch {
  info: BranchInfo;
  isRemote: boolean;
}

export function BranchPopover({
  port,
  projectId,
  chatId,
  open,
  onOpenChange,
  onBranchChanged,
  children,
}: BranchPopoverProps) {
  // Resolve adapterId from the active thread's custom — falls back to 'claude'.
  const adapterId = useAuiState((s) => {
    const custom = sessionCustomOf(s.threadListItem?.custom);
    return custom?.adapterId ?? DEFAULT_ADAPTER_ID;
  });

  const {
    branches,
    conflictFiles,
    busy,
    busyAction,
    loadBranches,
    handleCheckout,
    handlePull,
    handlePush,
    handleMerge,
    handleRebase,
    handleRename,
    handleDelete,
    handleDeleteWorktree,
    handleAbort,
    handleCreateBranch,
    handleFetch,
    handleUpdateAll,
  } = useBranchActions({ port, projectId, chatId });

  // Load branches lazily — only when the popover opens.
  useEffect(() => {
    if (!open) return;
    void loadBranches();
  }, [open, loadBranches]);

  const [view, setView] = useState<View>('list');
  const [selected, setSelected] = useState<SelectedBranch | null>(null);
  const [renameTarget, setRenameTarget] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [newBranchStartFrom, setNewBranchStartFrom] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const hasConflict = conflictFiles.length > 0 || !!branches?.activeOperation;

  // Reset on open. hasConflict excluded intentionally — live-conflict effect keeps it current.
  const hasConflictRef = useRef(hasConflict);
  hasConflictRef.current = hasConflict;
  useEffect(() => {
    if (!open) return;
    setView(hasConflictRef.current ? 'conflict' : 'list');
    setSearch('');
    setSelected(null);
  }, [open]);

  // Auto-route to conflict view when status changes while popover is open.
  useEffect(() => {
    if (!open) return;
    if (hasConflict && view === 'list') setView('conflict');
  }, [open, hasConflict, view]);

  const goToList = useCallback(() => {
    setView('list');
    setSelected(null);
    setSearch('');
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  // Selecting a branch opens its submenu BESIDE the list (no view switch).
  // Clicking the already-selected branch toggles the submenu closed.
  const handleSelectBranch = useCallback((branch: BranchInfo, isRemote = false) => {
    setSelected((prev) => (prev?.info.name === branch.name ? null : { info: branch, isRemote }));
  }, []);

  // Collapse the side-by-side submenu, leaving the list in place (no search reset).
  const closeSubmenu = useCallback(() => setSelected(null), []);

  const handleNewBranch = useCallback((startFrom?: string) => {
    setNewBranchStartFrom(startFrom);
    setView('new-branch');
  }, []);

  const handleRenameRequest = useCallback((branch: string) => {
    setRenameTarget(branch);
    setRenameValue(branch);
    setView('rename');
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    const ok = await handleRename(renameTarget, renameValue);
    if (ok) {
      onBranchChanged?.();
      goToList();
    }
  }, [handleRename, renameTarget, renameValue, goToList, onBranchChanged]);

  const handleCreate = useCallback(
    async (name: string, startPoint: string) => {
      const ok = await handleCreateBranch(name, startPoint);
      if (ok) {
        onBranchChanged?.();
        goToList();
      }
    },
    [handleCreateBranch, goToList, onBranchChanged],
  );

  const newSession = useWorktreeSession(port, projectId, adapterId);

  const handleNewSession = useCallback(
    (dirName: string, branchName?: string) => {
      void newSession(dirName, branchName);
      onOpenChange(false);
    },
    [newSession, onOpenChange],
  );

  const handleDeleteWorktreeAction = useCallback(
    async (dirName: string, branchName?: string): Promise<boolean> => {
      const ok = await handleDeleteWorktree(dirName, branchName);
      if (ok) goToList();
      return ok;
    },
    [handleDeleteWorktree, goToList],
  );

  const currentBranch = branches?.current ?? '';
  const localBranches = branches?.local ?? [];
  const remoteNames = branches?.remote ?? [];
  const worktrees = branches?.worktrees ?? [];

  // Remote BranchInfo stubs — same mapping as BranchList.tsx.
  const remoteBranchInfos: BranchInfo[] = remoteNames.map((name) => ({ name, current: false }));

  const isSelectedWorktree = selected != null && !!selected.info.worktree;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {children && <PopoverTrigger asChild>{children}</PopoverTrigger>}
      <PopoverContent
        data-testid="git-branch-popover"
        className="w-auto rounded-none border-0 bg-transparent p-0 shadow-none overflow-visible"
        align="start"
        side="bottom"
        sideOffset={4}
      >
        {view === 'list' && (
          <div className="flex items-start gap-1.5">
            <div className={cn(PANEL_CARD, 'w-[300px] shrink-0')}>
              <BranchListView
                local={localBranches}
                remote={remoteNames}
                worktrees={worktrees}
                currentBranch={currentBranch}
                selectedBranch={selected?.info.name}
                search={search}
                onSearch={setSearch}
                onSelectBranch={(b) => {
                  // Remote branches come in as non-worktree BranchInfos with no `worktree`
                  // field, identified by checking against the remote name list.
                  const isRemote = remoteNames.includes(b.name);
                  handleSelectBranch(b, isRemote);
                }}
                onNewBranch={() => handleNewBranch()}
                actions={{
                  handleFetch,
                  handleUpdateAll,
                  handlePush,
                  handleDeleteWorktree: handleDeleteWorktreeAction,
                  handleNewSession,
                }}
                busy={busy}
                busyAction={busyAction}
                searchRef={searchRef}
              />
            </div>
            {selected != null && (
              <div className={cn(PANEL_CARD, 'w-[260px] shrink-0')}>
                <BranchSubmenu
                  branch={selected.info.name}
                  isCurrent={selected.info.name === currentBranch}
                  isRemote={selected.isRemote}
                  isWorktree={isSelectedWorktree}
                  onClose={closeSubmenu}
                  onCheckout={(b) => {
                    void handleCheckout(b).then(() => onBranchChanged?.());
                  }}
                  onPull={(b) => {
                    void handlePull(b);
                  }}
                  onPush={(b) => {
                    void handlePush(b);
                  }}
                  onMerge={(b) => {
                    void handleMerge(b).then(() => onBranchChanged?.());
                  }}
                  onRebase={(b) => {
                    void handleRebase(b).then(() => onBranchChanged?.());
                  }}
                  onRename={handleRenameRequest}
                  onDelete={(b, isRemote) => {
                    void handleDelete(b, isRemote).then(() => onBranchChanged?.());
                  }}
                  onNewBranchFrom={(b) => handleNewBranch(b)}
                  onNewSession={
                    isSelectedWorktree
                      ? (b) => {
                          handleNewSession(selected.info.worktree!, b);
                        }
                      : undefined
                  }
                  onDeleteWorktree={
                    isSelectedWorktree
                      ? (b) => {
                          void handleDeleteWorktreeAction(selected.info.worktree!, b);
                        }
                      : undefined
                  }
                  busy={busy}
                />
              </div>
            )}
          </div>
        )}
        {view !== 'list' && (
          <div className={cn(PANEL_CARD, 'w-[300px]')}>
            {view === 'new-branch' && (
              <NewBranchDialog
                localBranches={localBranches.map((b) => b.name)}
                remoteBranches={remoteBranchInfos.map((b) => b.name)}
                currentBranch={currentBranch}
                startFrom={newBranchStartFrom}
                onBack={goToList}
                onCreate={handleCreate}
              />
            )}
            {view === 'rename' && (
              <RenameBranchView
                target={renameTarget}
                value={renameValue}
                onChange={setRenameValue}
                onSubmit={() => {
                  void handleRenameSubmit();
                }}
                onCancel={goToList}
                busy={busy}
              />
            )}
            {view === 'conflict' && (
              <ConflictView
                conflictFiles={conflictFiles}
                activeOperation={branches?.activeOperation}
                onAbort={() => {
                  void handleAbort().then(goToList);
                }}
                aborting={busyAction === 'abort'}
              />
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
