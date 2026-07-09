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
 * Accepts `children` as the BARE popover trigger (PopoverTrigger asChild),
 * matching the TagPopover pattern — and an optional `triggerLabel` for a
 * tooltip. `triggerLabel` wraps `PopoverTrigger` (a real forwardRef Radix
 * component) in `Hint`, not `children` directly: `Hint` is a plain function
 * component that doesn't forward arbitrary props/refs, so nesting it inside
 * `PopoverTrigger asChild` would silently drop the `ref`/`aria-expanded`/
 * `data-state` Radix's Slot needs to clone onto the real trigger DOM node —
 * without that ref, Popper has no reference element to anchor the content to,
 * so it stays at its un-positioned placeholder transform (see the
 * Hint-inside-asChild-trigger trap in `NewSessionPickerPopover`).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Hint } from '@/components/ui/hint';
import { activeSessionCustom } from '../sessions/view-model/chat-to-thread-custom';
import { useBranchActions } from './use-branch-actions';
import { useWorktreeSession } from './use-worktree-session';
import { BranchPopoverListPane } from './BranchPopoverListPane';
import { BranchPopoverOverlay } from './BranchPopoverOverlay';
import type { BranchInfo } from '@qlan-ro/mainframe-types';

type View = 'list' | 'new-branch' | 'conflict' | 'rename';

const DEFAULT_ADAPTER_ID = 'claude';

// Each panel (list, submenu, overlay) is its own card; the popover container is
// bare so the list + submenu read as two separate cards with a gap (13-popover
// artboard), not one merged surface.
const PANEL_CARD_SHELL = 'rounded-[11px] border border-border bg-popover shadow-[var(--mf-shadow-pop)] overflow-hidden';
const PANEL_CARD = cn(PANEL_CARD_SHELL, 'p-[5px]');

export interface BranchPopoverProps {
  port: number;
  projectId: string;
  chatId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBranchChanged?: () => void;
  /** Bare trigger element — do NOT pre-wrap in `Hint` (see file header). */
  children?: React.ReactElement;
  /** Optional tooltip label for the trigger; wraps `PopoverTrigger` in `Hint`. */
  triggerLabel?: string;
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
  triggerLabel,
}: BranchPopoverProps) {
  // Resolve adapterId from the active thread's custom — falls back to 'claude'.
  const adapterId = useAuiState((s) => {
    const custom = activeSessionCustom(s.threadListItem, s.threads.threadItems);
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

  const trigger = children ? <PopoverTrigger asChild>{children}</PopoverTrigger> : null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {trigger && (triggerLabel ? <Hint label={triggerLabel}>{trigger}</Hint> : trigger)}
      <PopoverContent
        data-testid="git-branch-popover"
        className="w-auto rounded-none border-0 bg-transparent p-0 shadow-none overflow-visible"
        align="start"
        side="bottom"
        sideOffset={4}
      >
        {view === 'list' && (
          <BranchPopoverListPane
            panelCard={PANEL_CARD}
            localBranches={localBranches}
            remoteNames={remoteNames}
            worktrees={worktrees}
            currentBranch={currentBranch}
            selected={selected}
            search={search}
            onSearch={setSearch}
            onSelectBranch={(b) => {
              // Remote branches come in as non-worktree BranchInfos with no `worktree`
              // field, identified by checking against the remote name list.
              const isRemote = remoteNames.includes(b.name);
              handleSelectBranch(b, isRemote);
            }}
            onNewBranch={() => handleNewBranch()}
            listActions={{
              handleFetch,
              handleUpdateAll,
              handlePush,
              handleDeleteWorktree: handleDeleteWorktreeAction,
              handleNewSession,
            }}
            busy={busy}
            busyAction={busyAction}
            searchRef={searchRef}
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
              selected?.info.worktree
                ? (b) => {
                    handleNewSession(selected.info.worktree!, b);
                  }
                : undefined
            }
            onDeleteWorktree={
              selected?.info.worktree
                ? (b) => {
                    void handleDeleteWorktreeAction(selected.info.worktree!, b);
                  }
                : undefined
            }
          />
        )}
        {view !== 'list' && (
          <BranchPopoverOverlay
            view={view}
            panelCard={PANEL_CARD}
            panelCardShell={PANEL_CARD_SHELL}
            localBranches={localBranches.map((b) => b.name)}
            remoteBranches={remoteBranchInfos.map((b) => b.name)}
            currentBranch={currentBranch}
            newBranchStartFrom={newBranchStartFrom}
            onBack={goToList}
            onCreate={handleCreate}
            renameTarget={renameTarget}
            renameValue={renameValue}
            onRenameChange={setRenameValue}
            onRenameSubmit={() => {
              void handleRenameSubmit();
            }}
            onRenameCancel={goToList}
            conflictFiles={conflictFiles}
            activeOperation={branches?.activeOperation}
            onAbort={() => {
              void handleAbort().then(goToList);
            }}
            aborting={busyAction === 'abort'}
            busy={busy}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
