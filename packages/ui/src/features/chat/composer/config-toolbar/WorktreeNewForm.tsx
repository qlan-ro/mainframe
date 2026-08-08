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
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BranchSelect } from '@/features/git/BranchSelect';

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
// WorktreeNewForm
// ---------------------------------------------------------------------------

export interface WorktreeNewFormProps {
  branches: string[];
  currentBranch: string;
  submitting: boolean;
  /** Withhold the form without hiding it (e.g. a turn is in flight). */
  disabled?: boolean;
  apiError: string | null;
  onEnable: (baseBranch: string, branchName: string) => void;
  onCancel: () => void;
}

export function WorktreeNewForm({
  branches,
  currentBranch,
  submitting,
  disabled = false,
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
  const canSubmit = !submitting && !disabled && !validationError && branchName.length > 0;

  function handleEnable() {
    setTouched(true);
    const err = validateBranchName(branchName);
    if (err) return;
    onEnable(effectiveBranch, branchName);
  }

  return (
    // px-2 matches the popover's section label and attach rows, so the fields
    // line up with the column above them rather than drifting 4px left.
    <div className="flex flex-col gap-2 px-2">
      {/* Base branch */}
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Base branch</Label>
        <BranchSelect
          value={effectiveBranch}
          options={branches}
          currentBranch={currentBranch}
          onChange={(v) => setBaseBranch(v)}
          testId="composer-worktree-base-branch"
          disabled={disabled}
        />
      </div>

      {/* Branch name — sans, not mono: the identifier signal is weight, not face. */}
      <div className="flex flex-col gap-1">
        <Label htmlFor="wt-branch-name" className="text-xs text-muted-foreground">
          Branch name
        </Label>
        <Input
          id="wt-branch-name"
          data-testid="composer-worktree-branch-name"
          disabled={disabled}
          value={branchName}
          onChange={(e) => {
            setBranchName(e.target.value);
            setTouched(true);
          }}
          placeholder="feat/my-branch"
          autoComplete="off"
          // The control styles its own invalid state off aria-invalid.
          aria-invalid={validationError != null}
          className="h-8 text-xs md:text-xs"
        />
        {validationError && <p className="text-xs text-destructive">{validationError}</p>}
      </div>

      {apiError && !validationError && <p className="text-xs text-destructive">{apiError}</p>}

      {/* Actions */}
      <div className="flex items-center justify-end gap-1.5">
        <Button variant="ghost" size="sm" data-testid="composer-worktree-cancel" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" data-testid="composer-worktree-enable" disabled={!canSubmit} onClick={handleEnable}>
          {submitting ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <Check data-icon="inline-start" />
          )}
          Enable
        </Button>
      </div>
    </div>
  );
}
