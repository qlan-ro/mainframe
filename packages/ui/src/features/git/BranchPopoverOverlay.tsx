/**
 * BranchPopoverOverlay — full-replace overlay views (new-branch / rename /
 * conflict) for BranchPopover. Extracted to keep BranchPopover.tsx under the
 * 300-line file limit; the side-by-side list+submenu view stays inline there
 * since it's the primary, most cohesive view.
 */
import { cn } from '@/lib/utils';
import { NewBranchDialog } from './NewBranchDialog';
import { RenameBranchView } from './RenameBranchView';
import { ConflictView, type ConflictFile } from './ConflictView';

export type OverlayView = 'new-branch' | 'rename' | 'conflict';

export interface BranchPopoverOverlayProps {
  view: OverlayView;
  panelCard: string;
  panelCardShell: string;
  localBranches: string[];
  remoteBranches: string[];
  currentBranch: string;
  newBranchStartFrom: string | undefined;
  onBack: () => void;
  onCreate: (name: string, startPoint: string) => Promise<void>;
  renameTarget: string;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  conflictFiles: ConflictFile[];
  activeOperation?: 'merge' | 'rebase';
  onAbort: () => void;
  aborting: boolean;
  busy: boolean;
}

export function BranchPopoverOverlay({
  view,
  panelCard,
  panelCardShell,
  localBranches,
  remoteBranches,
  currentBranch,
  newBranchStartFrom,
  onBack,
  onCreate,
  renameTarget,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  conflictFiles,
  activeOperation,
  onAbort,
  aborting,
  busy,
}: BranchPopoverOverlayProps) {
  if (view === 'conflict') {
    return (
      // No card padding here — ConflictView's own danger header must bleed
      // edge-to-edge under the card's rounded top corners (finding 10.1).
      <div className={cn(panelCardShell, 'w-[300px]')}>
        <ConflictView
          conflictFiles={conflictFiles}
          activeOperation={activeOperation}
          onAbort={onAbort}
          aborting={aborting}
        />
      </div>
    );
  }

  return (
    <div className={cn(panelCard, 'w-[300px]')}>
      {view === 'new-branch' && (
        <NewBranchDialog
          localBranches={localBranches}
          remoteBranches={remoteBranches}
          currentBranch={currentBranch}
          startFrom={newBranchStartFrom}
          onBack={onBack}
          onCreate={onCreate}
        />
      )}
      {view === 'rename' && (
        <RenameBranchView
          target={renameTarget}
          value={renameValue}
          onChange={onRenameChange}
          onSubmit={onRenameSubmit}
          onCancel={onRenameCancel}
          busy={busy}
        />
      )}
    </div>
  );
}
