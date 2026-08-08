/**
 * Rename and remove confirmations for a remote daemon. Both are small enough to
 * share one dialog; the kind picks the body.
 */
import { useCallback, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export type SmallDialogKind = 'rename' | 'remove';

interface BodyProps {
  target: DaemonMeta;
  onClose: () => void;
  onConfirm: (label?: string) => void;
}

function RenameBody({ target, onClose, onConfirm }: BodyProps) {
  const [label, setLabel] = useState(target.label);
  const trimmed = label.trim();

  const submit = useCallback(() => {
    if (trimmed) onConfirm(trimmed);
  }, [trimmed, onConfirm]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') submit();
    },
    [submit],
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename daemon</DialogTitle>
        <DialogDescription className="truncate font-mono">{target.host}</DialogDescription>
      </DialogHeader>
      <Input
        data-testid="daemon-dialog-input"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Daemon name"
        autoFocus
      />
      <DialogFooter>
        <Button variant="ghost" data-testid="daemon-dialog-cancel" onClick={onClose}>
          Cancel
        </Button>
        <Button data-testid="daemon-dialog-confirm" disabled={!trimmed} onClick={submit}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

function RemoveBody({ target, onClose, onConfirm }: BodyProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Remove daemon</DialogTitle>
        <DialogDescription className="truncate font-mono">{target.host}</DialogDescription>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">
        Removing <strong className="font-semibold text-foreground">{target.label}</strong> deletes its entry and erases
        its token from the system keyring. The server keeps running — you can pair it again later.
      </p>
      <DialogFooter>
        <Button variant="ghost" data-testid="daemon-dialog-cancel" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="destructive" data-testid="daemon-dialog-confirm" onClick={() => onConfirm()}>
          Remove
        </Button>
      </DialogFooter>
    </>
  );
}

export function DaemonSmallDialog({
  kind,
  target,
  onClose,
  onConfirm,
}: {
  kind: SmallDialogKind;
  target: DaemonMeta;
  onClose: () => void;
  onConfirm: (label?: string) => void;
}) {
  const Body = kind === 'rename' ? RenameBody : RemoveBody;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent data-testid={`daemon-dialog-${kind}`} showCloseButton={false}>
        <Body target={target} onClose={onClose} onConfirm={onConfirm} />
      </DialogContent>
    </Dialog>
  );
}
