'use client';

/**
 * BranchSelect — existing-branch picker (Popover + MenuSelectRow), extracted
 * from `chat/composer/config-toolbar/WorktreeNewForm.tsx` so it can be
 * reused wherever an existing branch needs picking (e.g. the Automations
 * Agent step's worktree `baseBranch`, todo #234 bullet 4) rather than typed
 * free-text. `WorktreeNewForm` now imports this instead of a private copy.
 */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { MenuSelectRow } from '@/components/ui/menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface BranchSelectProps {
  value: string;
  options: string[];
  currentBranch: string;
  onChange: (v: string) => void;
  /** Test id prefix for the trigger; `${testId}-list` and `${testId}-option-<branch>` key the popover contents. */
  testId: string;
}

export function BranchSelect({ value, options, currentBranch, onChange, testId }: BranchSelectProps) {
  const [open, setOpen] = useState(false);
  const label = value ? (value === currentBranch ? `${value} (current)` : value) : 'Select…';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          className={[
            'flex w-full items-center justify-between gap-[6px]',
            'rounded-[6px] border-[0.5px] border-border bg-muted',
            'px-[8px] py-[4px] text-caption text-foreground',
            'hover:bg-accent transition-colors focus-visible:outline-none',
          ].join(' ')}
        >
          <span className="truncate">{label}</span>
          <ChevronDown size={12} className="shrink-0 text-mf-text-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        data-testid={`${testId}-list`}
        align="start"
        side="top"
        sideOffset={4}
        className="max-h-[200px] w-[240px] overflow-y-auto p-[4px]"
      >
        {options.map((b) => (
          <MenuSelectRow
            key={b}
            data-testid={`${testId}-option-${b}`}
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
