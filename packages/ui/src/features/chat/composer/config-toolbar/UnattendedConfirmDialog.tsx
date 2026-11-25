'use client';

import type { CSSProperties } from 'react';
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
import { cn } from '@/lib/utils';
import type { UnattendedConfirm } from './use-unattended-confirm';

const CONFIRM_BUTTON =
  'h-7 rounded-md border-input bg-transparent px-[11px] dark:border-input dark:bg-transparent text-body font-medium shadow-none';
const GAP = 8;

/** Above the control, its left edge on the control's own, inside the window. */
function placeAbove(anchor: HTMLElement | undefined): CSSProperties | undefined {
  if (!anchor) return undefined;
  const { left, top } = anchor.getBoundingClientRect();
  return {
    left: `clamp(${GAP}px, ${left}px, calc(100vw - 18.75rem - ${GAP}px))`,
    top: 'auto',
    bottom: `calc(100vh - ${top - GAP}px)`,
    translate: 'none',
  };
}

/** "Run this session unattended?" (C13). Cancel takes the initial focus. */
export function UnattendedConfirmDialog({
  confirm,
  anchor,
  returnFocus,
}: {
  confirm: UnattendedConfirm;
  /** The control that asked: the question opens above it. Without one it is centred. */
  anchor?: () => HTMLElement | undefined;
  /** Puts focus back on the control that asked: the menu that opened this is gone. */
  returnFocus: () => void;
}) {
  return (
    <AlertDialog open={confirm.open} onOpenChange={(open) => !open && confirm.cancel()}>
      <AlertDialogContent
        data-testid="composer-unattended-confirm"
        overlayClassName="bg-transparent supports-backdrop-filter:backdrop-blur-none"
        className="w-75 max-w-[calc(100vw-1rem)] gap-0 px-3.5 pt-3.5 pb-3 sm:max-w-75"
        style={placeAbove(anchor?.())}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <AlertDialogHeader className="gap-1 text-left">
          <AlertDialogTitle className="text-title/[1.45]">Run this session unattended?</AlertDialogTitle>
          <AlertDialogDescription>
            The agent will run commands, edit files and use the network without asking you. It stops only when the turn
            ends or you stop it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-3 flex-row justify-end">
          <AlertDialogCancel className={CONFIRM_BUTTON} data-testid="composer-unattended-confirm-cancel">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="composer-unattended-confirm-confirm"
            className={cn(
              CONFIRM_BUTTON,
              'border-warning-border bg-warning-surface text-warning hover:bg-warning-surface hover:brightness-97 dark:border-warning-border dark:bg-warning-surface',
            )}
            onClick={confirm.confirm}
          >
            Run unattended
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
