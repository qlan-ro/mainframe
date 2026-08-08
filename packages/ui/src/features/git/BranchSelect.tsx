'use client';

/**
 * BranchSelect — existing-branch picker on the v2 `Select`, extracted from
 * `chat/composer/config-toolbar/WorktreeNewForm.tsx` so it can be reused
 * wherever an existing branch needs picking (e.g. the Automations Agent
 * step's worktree `baseBranch`, todo #234 bullet 4) rather than typed
 * free-text. `WorktreeNewForm` now imports this instead of a private copy.
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface BranchSelectProps {
  value: string;
  options: string[];
  currentBranch: string;
  onChange: (v: string) => void;
  /** Test id prefix for the trigger; `${testId}-list` and `${testId}-option-<branch>` key the popover contents. */
  testId: string;
  disabled?: boolean;
}

export function BranchSelect({ value, options, currentBranch, onChange, testId, disabled }: BranchSelectProps) {
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger data-testid={testId} size="sm" className="h-6.5 w-full text-xs">
        <SelectValue placeholder="Select…" />
      </SelectTrigger>
      <SelectContent data-testid={`${testId}-list`} position="popper" className="max-h-[200px]">
        {options.map((b) => (
          <SelectItem key={b} value={b} data-testid={`${testId}-option-${b}`} className="text-xs">
            {b === currentBranch ? `${b} (current)` : b}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
