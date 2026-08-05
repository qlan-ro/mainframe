/**
 * RenameBranchView — input + submit/cancel for renaming a branch.
 * Extracted from the inline RenameView in desktop BranchPopover.tsx.
 */
import { useEffect, useRef } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { Input } from '@v2/components/ui/input';

export interface RenameBranchViewProps {
  target: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
}

export function RenameBranchView({ target, value, onChange, onSubmit, onCancel, busy }: RenameBranchViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div data-testid="git-rename-view" className="flex flex-col gap-3 p-2">
      <div className="flex items-center gap-1.5">
        <Button
          data-testid="git-rename-back"
          variant="ghost"
          size="icon-xs"
          onClick={onCancel}
          className="size-5 text-muted-foreground"
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <span className="text-sm font-medium text-foreground">Rename Branch</span>
        {target && <span className="ml-1 truncate text-xs text-muted-foreground">'{target}'</span>}
      </div>

      <Input
        data-testid="git-rename-input"
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !busy && value.trim()) onSubmit();
        }}
        disabled={busy}
        className="h-8 text-sm"
      />

      <div className="flex justify-end gap-2">
        <Button data-testid="git-rename-cancel" variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button data-testid="git-rename-submit" size="sm" onClick={onSubmit} disabled={busy || !value.trim()}>
          {busy && <Loader2 className="size-3 animate-spin" />}
          Rename
        </Button>
      </div>
    </div>
  );
}
