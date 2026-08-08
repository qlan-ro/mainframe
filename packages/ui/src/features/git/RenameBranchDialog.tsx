/**
 * RenameBranchDialog — rename a branch, as a v2 Dialog (opened from the branch
 * menu's Rename… item — forms don't live inside Radix menus).
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
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

export interface RenameBranchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The branch being renamed; seeds the input on every open. */
  target: string;
  onSubmit: (nextName: string) => void;
  busy: boolean;
}

export function RenameBranchDialog({ open, onOpenChange, target, onSubmit, busy }: RenameBranchDialogProps) {
  const [value, setValue] = useState(target);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue(target);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, target]);

  const submit = () => {
    if (!busy && value.trim()) onSubmit(value.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="git-rename-view" className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="min-w-0">
            Rename Branch <span className="font-normal text-muted-foreground">'{target}'</span>
          </DialogTitle>
          <DialogDescription className="sr-only">Choose a new name for the branch.</DialogDescription>
        </DialogHeader>

        <Input
          data-testid="git-rename-input"
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          disabled={busy}
        />

        <DialogFooter>
          <Button data-testid="git-rename-cancel" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button data-testid="git-rename-submit" onClick={submit} disabled={busy || !value.trim()}>
            {busy && <Loader2 className="size-3 animate-spin" />}
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
