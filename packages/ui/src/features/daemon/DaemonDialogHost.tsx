/**
 * DaemonDialogHost — root-level host for the daemon add/repair/rename/remove
 * dialogs (mirrors the ArchiveWorktreeDialog/TagPopoverHost host-at-root
 * pattern), mounted as a SIBLING of `<AppShell key={target.id} />` in
 * DaemonGatedShell (App.tsx) — genuinely ABOVE the keyed subtree, not inside
 * AppShell's own root (where the archive/tag dialogs live and DO remount on a
 * daemon switch; don't move this one there).
 *
 * Why this exists: DaemonFooterStatus (the footer trigger + picker Popover)
 * used to own this dialog state itself, but DaemonFooterStatus lives INSIDE
 * the keyed subtree. Switching daemons — including the auto-switch in
 * AddRemoteDialog.handleConfirm after registry.switchTo — remounted the whole
 * subtree and destroyed an in-flight dialog before it could finish (e.g. the
 * ~800ms "Paired" confirmation never rendered). Moving the RENDERING here (the
 * trigger + Popover stay in DaemonFooterStatus) means a daemon switch no
 * longer tears down a dialog that's mid-flow.
 */
import { useCallback } from 'react';
import { AddRemoteDialog } from './AddRemoteDialog';
import { DaemonSmallDialog } from './DaemonSmallDialog';
import { useDaemonRegistry } from './use-daemon-registry';
import { useDaemonDialogTarget } from './use-daemon-dialog-target';

export function DaemonDialogHost() {
  const dialog = useDaemonDialogTarget((s) => s.dialog);
  const closeDialog = useDaemonDialogTarget((s) => s.close);
  const registry = useDaemonRegistry();

  // AddRemoteDialog fires onDone the instant pairing succeeds, then defers its
  // own onClose by ~800ms so the "Paired" notice stays visible. onDone must
  // NOT also close the dialog here, or that grace window collapses to zero.
  const handlePairingDone = useCallback(() => {
    /* no-op: dismissal is owned by the dialog's deferred onClose */
  }, []);

  const handleRenameConfirm = useCallback(
    async (label?: string) => {
      if (dialog?.kind === 'rename' && label != null) {
        await registry.rename(dialog.target.id, label);
      }
      closeDialog();
    },
    [dialog, registry, closeDialog],
  );

  const handleRemoveConfirm = useCallback(async () => {
    if (dialog?.kind === 'remove') {
      await registry.remove(dialog.target.id);
    }
    closeDialog();
  }, [dialog, registry, closeDialog]);

  return (
    <>
      <AddRemoteDialog
        open={dialog?.kind === 'add' || dialog?.kind === 'repair'}
        mode={dialog?.kind === 'repair' ? 'repair' : 'add'}
        target={dialog?.kind === 'repair' ? dialog.target : undefined}
        onClose={closeDialog}
        onDone={handlePairingDone}
      />

      {(dialog?.kind === 'rename' || dialog?.kind === 'remove') && (
        <DaemonSmallDialog
          open
          kind={dialog.kind}
          target={dialog.target}
          onClose={closeDialog}
          onConfirm={
            dialog.kind === 'rename' ? (label) => void handleRenameConfirm(label) : () => void handleRemoveConfirm()
          }
        />
      )}
    </>
  );
}
