/**
 * BranchPopover — the toolbar's branch menu, a native DropdownMenu: search +
 * quick actions + grouped branch list, with each branch's actions in a
 * DropdownMenuSub flyout. Forms don't live inside Radix menus, so New Branch /
 * Rename are v2 Dialogs the menu hands off to, and an active merge/rebase
 * conflict swaps the menu for a conflict Dialog.
 *
 * Branches are loaded LAZILY — only when `open` becomes true. The closed
 * menu never fires git fetches, so AppShell integration tests pass cleanly.
 *
 * Accepts `children` as the BARE menu trigger (DropdownMenuTrigger asChild),
 * and an optional `triggerLabel` for a tooltip. `triggerLabel` wraps
 * `DropdownMenuTrigger` (a real forwardRef Radix component) in `Hint`, not
 * `children` directly: `Hint` is a plain function component that doesn't
 * forward arbitrary props/refs, so nesting it inside the asChild clone would
 * drop the ref/aria-expanded/data-state Radix's Slot needs on the real
 * trigger DOM node (the Hint-inside-asChild-trigger trap).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Hint } from '@/components/ui/hint';
import { useBranchActions } from './use-branch-actions';
import { useNewSessionAction } from './use-new-session-action';
import { BranchListView } from './BranchListView';
import { ConflictView } from './ConflictView';
import { NewBranchDialog } from './NewBranchDialog';
import { RenameBranchDialog } from './RenameBranchDialog';
import type { BranchRowActions } from './BranchSubmenu';

type DialogState = { kind: 'new-branch'; startFrom?: string } | { kind: 'rename'; target: string } | null;

export interface BranchPopoverProps {
  port: number;
  projectId: string;
  chatId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBranchChanged?: () => void;
  /** Bare trigger element — do NOT pre-wrap in `Hint` (see file header). */
  children?: React.ReactElement;
  /** Optional tooltip label for the trigger; wraps `DropdownMenuTrigger` in `Hint`. */
  triggerLabel?: string;
}

export function BranchPopover({
  port,
  projectId,
  chatId,
  open,
  onOpenChange,
  onBranchChanged,
  children,
  triggerLabel,
}: BranchPopoverProps) {
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

  // Load branches lazily — only when the menu opens.
  useEffect(() => {
    if (!open) return;
    void loadBranches();
  }, [open, loadBranches]);

  const [dialog, setDialog] = useState<DialogState>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const hasConflict = conflictFiles.length > 0 || !!branches?.activeOperation;

  // Reset search on open.
  useEffect(() => {
    if (open) setSearch('');
  }, [open]);

  // An active merge/rebase replaces the menu with the conflict dialog — both
  // on open and live, if the status flips while the menu is up.
  useEffect(() => {
    if (open && hasConflict) {
      onOpenChange(false);
      setConflictOpen(true);
    }
  }, [open, hasConflict, onOpenChange]);

  const closeMenu = useCallback(() => onOpenChange(false), [onOpenChange]);
  const handleNewSession = useNewSessionAction(port, projectId, closeMenu);

  const handleCreate = useCallback(
    async (name: string, startPoint: string) => {
      const ok = await handleCreateBranch(name, startPoint);
      if (ok) {
        onBranchChanged?.();
        setDialog(null);
      }
    },
    [handleCreateBranch, onBranchChanged],
  );

  const handleRenameSubmit = useCallback(
    (target: string, next: string) => {
      void handleRename(target, next).then((ok) => {
        if (ok) {
          onBranchChanged?.();
          setDialog(null);
        }
      });
    },
    [handleRename, onBranchChanged],
  );

  const currentBranch = branches?.current ?? '';
  const localBranches = branches?.local ?? [];
  const remoteNames = branches?.remote ?? [];
  const worktrees = branches?.worktrees ?? [];

  const rowActions: BranchRowActions = {
    onCheckout: (b) => {
      void handleCheckout(b).then(() => onBranchChanged?.());
    },
    onPull: (b) => {
      void handlePull(b);
    },
    onPush: (b) => {
      void handlePush(b);
    },
    onMerge: (b) => {
      void handleMerge(b).then(() => onBranchChanged?.());
    },
    onRebase: (b) => {
      void handleRebase(b).then(() => onBranchChanged?.());
    },
    onRename: (b) => setDialog({ kind: 'rename', target: b }),
    onDelete: (b, isRemote) => {
      void handleDelete(b, isRemote).then(() => onBranchChanged?.());
    },
    onNewBranchFrom: (b) => setDialog({ kind: 'new-branch', startFrom: b }),
    onNewSession: handleNewSession,
    onDeleteWorktree: (dirName, branchName) => {
      void handleDeleteWorktree(dirName, branchName);
    },
    busy,
  };

  const trigger = children ? <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger> : null;

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        {trigger && (triggerLabel ? <Hint label={triggerLabel}>{trigger}</Hint> : trigger)}
        <DropdownMenuContent
          data-testid="git-branch-popover"
          className="w-[300px]"
          align="start"
          side="bottom"
          sideOffset={4}
        >
          <BranchListView
            local={localBranches}
            remote={remoteNames}
            worktrees={worktrees}
            currentBranch={currentBranch}
            search={search}
            onSearch={setSearch}
            onNewBranch={() => setDialog({ kind: 'new-branch' })}
            actions={{ handleFetch, handleUpdateAll, handlePush }}
            rowActions={rowActions}
            busy={busy}
            busyAction={busyAction}
            searchRef={searchRef}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <NewBranchDialog
        open={dialog?.kind === 'new-branch'}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
        localBranches={localBranches.map((b) => b.name)}
        remoteBranches={remoteNames}
        currentBranch={currentBranch}
        startFrom={dialog?.kind === 'new-branch' ? dialog.startFrom : undefined}
        onCreate={handleCreate}
      />

      <RenameBranchDialog
        open={dialog?.kind === 'rename'}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
        target={dialog?.kind === 'rename' ? dialog.target : ''}
        onSubmit={(next) => {
          if (dialog?.kind === 'rename') handleRenameSubmit(dialog.target, next);
        }}
        busy={busy}
      />

      <Dialog
        open={conflictOpen}
        onOpenChange={(o) => {
          if (!o) setConflictOpen(false);
        }}
      >
        <DialogContent className="gap-0 p-0 sm:max-w-sm" closeButtonClassName="top-2.5">
          <DialogTitle className="sr-only">Merge / Rebase Conflicts</DialogTitle>
          <DialogDescription className="sr-only">Resolve or abort the git operation in progress.</DialogDescription>
          <ConflictView
            conflictFiles={conflictFiles}
            activeOperation={branches?.activeOperation}
            onAbort={() => {
              void handleAbort().then(() => setConflictOpen(false));
            }}
            aborting={busyAction === 'abort'}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
