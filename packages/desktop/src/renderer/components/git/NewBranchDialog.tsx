import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

interface NewBranchDialogProps {
  localBranches: string[];
  currentBranch: string;
  startFrom?: string;
  onBack: () => void;
  onCreate: (name: string, startPoint: string) => Promise<void>;
}

const BRANCH_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;

export function NewBranchDialog({
  localBranches,
  currentBranch,
  startFrom,
  onBack,
  onCreate,
}: NewBranchDialogProps): React.ReactElement {
  const [name, setName] = useState('');
  const [startPoint, setStartPoint] = useState(startFrom ?? currentBranch);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const validate = (value: string): string | null => {
    if (!value.trim()) return 'Branch name is required';
    if (!BRANCH_NAME_RE.test(value)) return 'Invalid branch name';
    if (localBranches.includes(value)) return 'Branch already exists';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate(name);
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
  };

  return (
    <div className="min-w-[280px]">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-mf-border">
        <button onClick={onBack} className="p-0.5 hover:bg-mf-hover rounded text-mf-text-secondary">
          <ArrowLeft size={14} />
        </button>
        <span className="text-xs font-medium text-mf-text-primary">New Branch</span>
      </div>

      <form onSubmit={handleSubmit} className="p-3 space-y-3">
        {/* Branch name */}
        <div>
          <label className="block text-[10px] font-medium text-mf-text-secondary mb-1">Branch name</label>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="feature/my-branch"
            className={cn(
              'w-full px-2 py-1 text-xs rounded border bg-mf-app-bg text-mf-text-primary',
              'focus:outline-none focus:ring-1 focus:ring-mf-accent',
              error ? 'border-mf-destructive' : 'border-mf-border',
            )}
            disabled={creating}
          />
          {error && <p className="mt-1 text-[10px] text-mf-destructive">{error}</p>}
        </div>

        {/* Start from */}
        <div>
          <label className="block text-[10px] font-medium text-mf-text-secondary mb-1">Start from</label>
          <select
            value={startPoint}
            onChange={(e) => setStartPoint(e.target.value)}
            disabled={creating}
            className="w-full px-2 py-1 text-xs rounded border border-mf-border bg-mf-app-bg text-mf-text-primary focus:outline-none focus:ring-1 focus:ring-mf-accent"
          >
            {localBranches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onBack}
            disabled={creating}
            className="px-3 py-1 text-xs rounded border border-mf-border text-mf-text-secondary hover:bg-mf-hover"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className={cn(
              'px-3 py-1 text-xs rounded text-white',
              'bg-mf-accent hover:opacity-80 transition-opacity',
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
