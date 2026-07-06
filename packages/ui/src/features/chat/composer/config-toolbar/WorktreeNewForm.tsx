'use client';

/**
 * WorktreeNewForm — the "New" tab body inside WorktreePopover.
 *
 * Contains the base-branch selector, branch-name input, validation, and
 * the Enable / Cancel button pair. Extracted so WorktreePopover.tsx stays
 * under 300 lines.
 *
 * Validation rules (ported verbatim from the desktop WorktreePopover):
 *  - Non-empty
 *  - Matches BRANCH_RE (alphanumeric + . _ / -)
 *  - Does not contain ".."
 */

import { useState } from 'react';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { MenuSelectRow } from '@/components/ui/menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// ---------------------------------------------------------------------------
// Branch name validation (ported from desktop)
// ---------------------------------------------------------------------------

const BRANCH_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

export function validateBranchName(name: string): string | null {
  if (!name) return 'Branch name is required';
  if (!BRANCH_RE.test(name)) return 'Invalid characters — use letters, digits, . _ / -';
  if (name.includes('..')) return 'Branch name must not contain ".."';
  return null;
}

// ---------------------------------------------------------------------------
// Base-branch selector (Popover + MenuSelectRow)
// ---------------------------------------------------------------------------

interface BranchSelectProps {
  value: string;
  options: string[];
  currentBranch: string;
  onChange: (v: string) => void;
}

function BranchSelect({ value, options, currentBranch, onChange }: BranchSelectProps) {
  const [open, setOpen] = useState(false);
  const label = value ? (value === currentBranch ? `${value} (current)` : value) : 'Select…';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="composer-worktree-base-branch"
          className={[
            'flex w-full items-center justify-between gap-[6px]',
            'rounded-[6px] border-[0.5px] border-border bg-muted',
            'px-[8px] py-[4px] text-caption text-foreground',
            'hover:bg-accent transition-colors focus-visible:outline-none',
          ].join(' ')}
        >
          <span className="truncate">{label}</span>
          <ChevronDown size={11} className="shrink-0 text-mf-text-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        data-testid="composer-worktree-base-branch-list"
        align="start"
        side="top"
        sideOffset={4}
        className="max-h-[200px] w-[240px] overflow-y-auto p-[4px]"
      >
        {options.map((b) => (
          <MenuSelectRow
            key={b}
            data-testid={`composer-worktree-base-branch-option-${b}`}
            selected={b === value}
            label={b === currentBranch ? `${b} (current)` : b}
            onClick={() => {
              onChange(b);
              setOpen(false);
            }}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// WorktreeNewForm
// ---------------------------------------------------------------------------

export interface WorktreeNewFormProps {
  branches: string[];
  currentBranch: string;
  submitting: boolean;
  apiError: string | null;
  onEnable: (baseBranch: string, branchName: string) => void;
  onCancel: () => void;
}

export function WorktreeNewForm({
  branches,
  currentBranch,
  submitting,
  apiError,
  onEnable,
  onCancel,
}: WorktreeNewFormProps) {
  const [baseBranch, setBaseBranch] = useState<string>(currentBranch || branches[0] || '');
  const [branchName, setBranchName] = useState('');
  const [touched, setTouched] = useState(false);

  // Sync baseBranch when branches load after mount
  const effectiveBranch = baseBranch || currentBranch || branches[0] || '';

  const validationError = touched || branchName ? validateBranchName(branchName) : null;
  const canSubmit = !submitting && !validationError && branchName.length > 0;

  function handleEnable() {
    setTouched(true);
    const err = validateBranchName(branchName);
    if (err) return;
    onEnable(effectiveBranch, branchName);
  }

  return (
    <div className="space-y-[6px]">
      {/* Base branch */}
      <div>
        <label className="mb-[3px] block text-micro text-mf-text-3">Base branch</label>
        <BranchSelect
          value={effectiveBranch}
          options={branches}
          currentBranch={currentBranch}
          onChange={(v) => setBaseBranch(v)}
        />
      </div>

      {/* Branch name */}
      <div>
        <label className="mb-[3px] block text-micro text-mf-text-3" htmlFor="wt-branch-name">
          Branch name
        </label>
        <input
          id="wt-branch-name"
          type="text"
          data-testid="composer-worktree-branch-name"
          value={branchName}
          onChange={(e) => {
            setBranchName(e.target.value);
            setTouched(true);
          }}
          placeholder="feat/my-branch"
          autoComplete="off"
          className={[
            'w-full rounded-[6px] border-[0.5px] bg-muted px-[8px] py-[4px]',
            'font-mono text-caption text-foreground placeholder:text-mf-text-3',
            'outline-none transition-colors focus:border-primary',
            validationError ? 'border-destructive' : 'border-border',
          ].join(' ')}
        />
        {validationError && <p className="mt-[2px] text-micro text-destructive">{validationError}</p>}
      </div>

      {apiError && !validationError && <p className="text-micro text-destructive">{apiError}</p>}

      {/* Actions */}
      <div className="flex items-center justify-end gap-[6px] pt-[2px]">
        <button
          type="button"
          data-testid="composer-worktree-cancel"
          onClick={onCancel}
          className={[
            'rounded-[6px] px-[10px] py-[4px] text-caption text-mf-text-3',
            'hover:bg-accent hover:text-foreground transition-colors',
          ].join(' ')}
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="composer-worktree-enable"
          disabled={!canSubmit}
          onClick={handleEnable}
          className={[
            'flex items-center gap-[4px] rounded-[6px] px-[10px] py-[4px]',
            'bg-primary text-caption text-primary-foreground',
            'hover:opacity-90 transition-opacity',
            'disabled:pointer-events-none disabled:opacity-40',
          ].join(' ')}
        >
          {submitting ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          Enable
        </button>
      </div>
    </div>
  );
}
