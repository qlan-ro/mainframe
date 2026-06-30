/**
 * DaemonSmallDialog — rename and remove daemon surfaces.
 *
 * Exports:
 *   RenameRemoveBody  — pure/controlled card body (rename or remove).
 *   DaemonSmallDialog — Dialog wrapper for the body.
 *
 * Visual spec: 17-daemon.jsx (rename/remove cards).
 * Token mapping: task-B8-brief.md.
 */
import { useState, useCallback } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type SmallDialogKind = 'rename' | 'remove';

export interface RenameRemoveBodyProps {
  kind: SmallDialogKind;
  target: DaemonMeta;
  onClose: () => void;
  /** rename: called with the new label string; remove: called with no arg */
  onConfirm: (label?: string) => void;
}

// ---------------------------------------------------------------------------
// Icon chip helper
// ---------------------------------------------------------------------------

function IconChip({ kind }: { kind: SmallDialogKind }) {
  const isRemove = kind === 'remove';
  return (
    <span
      className={cn(
        'flex size-[38px] shrink-0 items-center justify-center rounded-lg',
        isRemove ? 'bg-destructive/10' : 'bg-primary/10',
      )}
    >
      {isRemove ? (
        <Trash2 size={18} className="text-destructive" aria-hidden />
      ) : (
        <Pencil size={18} className="text-primary" aria-hidden />
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// RenameBody
// ---------------------------------------------------------------------------

interface RenameBodyProps {
  target: DaemonMeta;
  onClose: () => void;
  onConfirm: (label: string) => void;
}

function RenameBody({ target, onClose, onConfirm }: RenameBodyProps) {
  const [label, setLabel] = useState(target.label);

  const handleSubmit = useCallback(() => {
    const trimmed = label.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  }, [label, onConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') handleSubmit();
    },
    [handleSubmit],
  );

  return (
    <>
      {/* Header */}
      <div className="flex items-start gap-[12px] pb-[14px]">
        <IconChip kind="rename" />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <h2 className="text-heading font-semibold text-foreground leading-tight">Rename daemon</h2>
          <p className="font-mono text-caption text-mf-text-3 truncate">{target.host}</p>
        </div>
      </div>

      {/* Input */}
      <div className="pb-[16px]">
        <Input
          data-testid="daemon-rename-input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          placeholder="Daemon name"
        />
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-[8px]">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button data-testid="daemon-rename-save" size="sm" disabled={!label.trim()} onClick={handleSubmit}>
          Save
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// RemoveBody
// ---------------------------------------------------------------------------

interface RemoveBodyProps {
  target: DaemonMeta;
  onClose: () => void;
  onConfirm: () => void;
}

function RemoveBody({ target, onClose, onConfirm }: RemoveBodyProps) {
  return (
    <>
      {/* Header */}
      <div className="flex items-start gap-[12px] pb-[14px]">
        <IconChip kind="remove" />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <h2 className="text-heading font-semibold text-foreground leading-tight">Remove daemon</h2>
          <p className="font-mono text-caption text-mf-text-3 truncate">{target.host}</p>
        </div>
      </div>

      {/* Body copy */}
      <p className="pb-[16px] text-body text-muted-foreground leading-normal">
        Removing <strong className="font-semibold text-foreground">{target.label}</strong> deletes its entry and erases
        its token from the system keyring. The server keeps running — you can pair it again later.
      </p>

      {/* Footer */}
      <div className="flex justify-end gap-[8px]">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button data-testid="daemon-remove-confirm" variant="destructive" size="sm" onClick={onConfirm}>
          Remove
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// RenameRemoveBody (public — used by tests + dialog)
// ---------------------------------------------------------------------------

export function RenameRemoveBody({ kind, target, onClose, onConfirm }: RenameRemoveBodyProps) {
  if (kind === 'rename') {
    return <RenameBody target={target} onClose={onClose} onConfirm={(label) => onConfirm(label)} />;
  }

  return <RemoveBody target={target} onClose={onClose} onConfirm={() => onConfirm()} />;
}

// ---------------------------------------------------------------------------
// DaemonSmallDialog
// ---------------------------------------------------------------------------

export interface DaemonSmallDialogProps {
  open: boolean;
  kind: SmallDialogKind;
  target: DaemonMeta;
  onClose: () => void;
  onConfirm: (label?: string) => void;
}

export function DaemonSmallDialog({ open, kind, target, onClose, onConfirm }: DaemonSmallDialogProps) {
  const testId = kind === 'rename' ? 'daemon-rename-dialog' : 'daemon-remove-dialog';

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent data-testid={testId} className="p-[20px] max-w-[400px]" hideClose>
        <RenameRemoveBody kind={kind} target={target} onClose={onClose} onConfirm={onConfirm} />
      </DialogContent>
    </Dialog>
  );
}
