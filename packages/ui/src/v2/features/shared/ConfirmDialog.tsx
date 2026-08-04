/**
 * The one confirm recipe — a stock AlertDialog behind the same props as the
 * v1 ConfirmDialog, so bridge outlets (git confirm, tuning warning) swap in
 * without touching their state stores.
 *
 * AlertDialog, not Dialog, on purpose: a confirm interrupts, has no close ×,
 * and shouldn't dismiss on an outside click.
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@v2/components/ui/alert-dialog';
import { Checkbox } from '@v2/components/ui/checkbox';
import { Label } from '@v2/components/ui/label';

export interface ConfirmDialogSuppress {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  suppress?: ConfirmDialogSuppress;
  testid?: string;
}

function SuppressRow({ suppress, testid }: { suppress: ConfirmDialogSuppress; testid: string }) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={`${testid}-suppress`}
        data-testid={`${testid}-suppress`}
        checked={suppress.checked}
        onCheckedChange={(value) => suppress.onChange(value === true)}
      />
      <Label htmlFor={`${testid}-suppress`} className="cursor-pointer text-xs text-muted-foreground">
        {suppress.label}
      </Label>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
  suppress,
  testid = 'confirm-dialog',
}: ConfirmDialogProps) {
  // Rendered closed rather than early-returning null: unmounting a Radix
  // modal while it is still open leaves `pointer-events: none` on <body>.
  // Driving `open` lets Radix close (and clean up) before anything unmounts.
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <AlertDialogContent data-testid={testid}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {body && <AlertDialogDescription>{body}</AlertDialogDescription>}
        </AlertDialogHeader>
        {suppress && <SuppressRow suppress={suppress} testid={testid} />}
        <AlertDialogFooter>
          {/* preventDefault stops Radix's own close — otherwise onOpenChange
              fires after the click and resolves the bridge a second time. The
              caller's state flip is what closes the dialog. */}
          <AlertDialogCancel
            data-testid={`${testid}-cancel`}
            onClick={(e) => {
              e.preventDefault();
              onCancel();
            }}
          >
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid={`${testid}-confirm`}
            variant={destructive ? 'destructive' : 'default'}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
