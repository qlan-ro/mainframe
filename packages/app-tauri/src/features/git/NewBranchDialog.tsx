/**
 * NewBranchDialog — name input + start-point select for creating a new branch.
 * BRANCH_NAME_RE ported verbatim from desktop NewBranchDialog.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export const BRANCH_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;

export interface NewBranchDialogProps {
  localBranches: string[];
  remoteBranches: string[];
  currentBranch: string;
  startFrom?: string;
  onBack: () => void;
  onCreate: (name: string, startPoint: string) => Promise<void>;
}

function validate(name: string, localBranches: string[]): string | null {
  if (!name.trim()) return 'Branch name is required';
  if (!BRANCH_NAME_RE.test(name)) return 'Invalid branch name';
  if (localBranches.includes(name)) return 'Branch already exists';
  return null;
}

export function NewBranchDialog({
  localBranches,
  remoteBranches,
  currentBranch,
  startFrom,
  onBack,
  onCreate,
}: NewBranchDialogProps) {
  const [name, setName] = useState('');
  const [startPoint, setStartPoint] = useState(startFrom ?? currentBranch);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const err = validate(name, localBranches);
    if (err) {
      setError(err);
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await onCreate(name.trim(), startPoint);
    } catch (err) {
      setError(String(err));
      setCreating(false);
    }
  }

  return (
    <div data-testid="git-new-branch-dialog" className="min-w-[280px]">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border">
        <button
          data-testid="git-new-branch-back"
          onClick={onBack}
          className="p-0.5 hover:bg-accent rounded text-muted-foreground"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-body font-medium text-foreground">New Branch</span>
      </div>

      <form onSubmit={handleSubmit} className="p-3 space-y-3">
        <div>
          <label className="block text-label font-medium text-muted-foreground mb-1">Branch name</label>
          <input
            data-testid="git-new-branch-name"
            ref={inputRef}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="feature/my-branch"
            disabled={creating}
            className={cn(
              'w-full h-[30px] px-[9px] rounded-md border-[0.5px] bg-background font-mono text-caption text-foreground',
              'focus:outline-none focus:ring-1 focus:ring-primary',
              error ? 'border-destructive' : 'border-border',
            )}
          />
          {error && <p className="mt-1 text-caption text-destructive">{error}</p>}
        </div>

        <div>
          <label className="block text-label font-medium text-muted-foreground mb-1">Start from</label>
          <select
            data-testid="git-new-branch-start"
            value={startPoint}
            onChange={(e) => setStartPoint(e.target.value)}
            disabled={creating}
            className="w-full h-[30px] px-[9px] rounded-md border-[0.5px] border-border bg-background font-mono text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <optgroup label="Local">
              {localBranches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </optgroup>
            {remoteBranches.length > 0 && (
              <optgroup label="Remote">
                {remoteBranches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            data-testid="git-new-branch-cancel"
            type="button"
            onClick={onBack}
            disabled={creating}
            className="px-3 h-[28px] text-body rounded border border-border text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            data-testid="git-new-branch-create"
            type="submit"
            disabled={creating || !name.trim()}
            className={cn(
              'px-3 h-[28px] text-body rounded text-primary-foreground bg-primary hover:opacity-90 transition-opacity',
              (creating || !name.trim()) && 'opacity-40 cursor-not-allowed',
            )}
          >
            {creating ? <Loader2 size={12} className="animate-spin" /> : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
