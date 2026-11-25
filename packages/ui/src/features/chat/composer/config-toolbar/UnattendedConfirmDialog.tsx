'use client';

import { useCallback } from 'react';
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
  anchor,
}: {
  confirm: UnattendedConfirm;
  /** Puts focus back on the control that asked: the menu that opened this is gone. */
  returnFocus: () => void;
  anchor?: () => HTMLElement | undefined;
}) {
  const placeContent = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element || !anchor) return;
      const place = () => {
        const trigger = anchor()?.getBoundingClientRect();
        if (!trigger) return;
        element.style.left = `${Math.max(8, Math.min(trigger.left, window.innerWidth - element.offsetWidth - 8))}px`;
        element.style.top = `${Math.max(8, trigger.top - element.offsetHeight - 8)}px`;
        element.style.translate = 'none';
      };
      place();
      window.addEventListener('resize', place);
      return () => window.removeEventListener('resize', place);
    },
    [anchor],
  );
  return (
    <AlertDialog open={confirm.open} onOpenChange={(open) => !open && confirm.cancel()}>
      <AlertDialogContent
        ref={placeContent}
        data-testid="composer-unattended-confirm"
        className="max-h-[calc(100dvh-16px)] w-[300px] max-w-[calc(100%-16px)] gap-3 overflow-y-auto rounded-[12px] px-3.5 pt-3.5 pb-3 text-control/[1.45] sm:max-w-[300px]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <AlertDialogHeader className="gap-1 text-left">
          <AlertDialogTitle className="text-title/[1.45]">Run this session unattended?</AlertDialogTitle>
          <AlertDialogDescription className="text-control/[1.45] text-ink-secondary">
            The agent will run commands, edit files and use the network without asking you. It stops only when the turn
            ends or you stop it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-row justify-end">
          <AlertDialogCancel data-testid="composer-unattended-confirm-cancel" className="h-7 px-3">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="composer-unattended-confirm-confirm"
            className="h-7 border border-warning/40 px-3 bg-warning/10 text-warning hover:bg-warning/20"
            onClick={confirm.confirm}
          >
            Run unattended
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
