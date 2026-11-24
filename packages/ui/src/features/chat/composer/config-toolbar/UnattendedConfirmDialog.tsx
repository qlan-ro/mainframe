'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { UnattendedConfirm } from './use-unattended-confirm';

/** "Run this session unattended?" (C13). Cancel takes the initial focus. */
export function UnattendedConfirmDialog({
  confirm,
  returnFocus,
}: {
  confirm: UnattendedConfirm;
  /** Puts focus back on the control that asked: the menu that opened this is gone. */
  returnFocus: () => void;
}) {
  return (
    <AlertDialog open={confirm.open} onOpenChange={(open) => !open && confirm.cancel()}>
      <AlertDialogContent
        data-testid="composer-unattended-confirm"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Run this session unattended?</AlertDialogTitle>
          <AlertDialogDescription>
            The agent will run commands, edit files and use the network without asking you. It stops only when the turn
            ends or you stop it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="composer-unattended-confirm-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            data-testid="composer-unattended-confirm-confirm"
            className="border border-warning/40 bg-warning/10 text-warning hover:bg-warning/20"
            onClick={confirm.confirm}
          >
            Run unattended
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
