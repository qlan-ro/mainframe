import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

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
    <div className="flex items-center gap-2 pt-1">
      <Checkbox
        id={`${testid}-suppress`}
        data-testid={`${testid}-suppress`}
        checked={suppress.checked}
        onCheckedChange={(value) => suppress.onChange(value === true)}
      />
      <Label htmlFor={`${testid}-suppress`} className="cursor-pointer text-caption text-muted-foreground">
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
  if (!open) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent data-testid={testid}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {body && <p className="text-body text-muted-foreground">{body}</p>}
        {suppress && <SuppressRow suppress={suppress} testid={testid} />}
        <DialogFooter className="gap-2">
          <Button data-testid={`${testid}-cancel`} variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            data-testid={`${testid}-confirm`}
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
