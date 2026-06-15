/**
 * RenameBranchView — input + submit/cancel for renaming a branch.
 * Extracted from the inline RenameView in desktop BranchPopover.tsx.
 */
import { useEffect, useRef } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

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
    <div data-testid="git-rename-view" className="p-3 space-y-3">
      <div className="flex items-center gap-1.5">
        <button
          data-testid="git-rename-back"
          onClick={onCancel}
          className="p-0.5 hover:bg-accent rounded text-muted-foreground"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-body font-medium text-foreground">Rename Branch</span>
        {target && <span className="text-caption text-muted-foreground truncate ml-1">'{target}'</span>}
      </div>

      <input
        data-testid="git-rename-input"
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !busy && value.trim()) onSubmit();
        }}
        disabled={busy}
        className="w-full px-2 py-1 text-body rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />

      <div className="flex justify-end gap-2">
        <button
          data-testid="git-rename-cancel"
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1 text-body rounded border border-border text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
        <button
          data-testid="git-rename-submit"
          onClick={onSubmit}
          disabled={busy || !value.trim()}
          className={cn(
            'px-3 py-1 text-body rounded text-primary-foreground bg-primary hover:opacity-90 transition-opacity flex items-center gap-1.5',
            (busy || !value.trim()) && 'opacity-40 cursor-not-allowed',
          )}
        >
          {busy && <Loader2 size={11} className="animate-spin" />}
          Rename
        </button>
      </div>
    </div>
  );
}
