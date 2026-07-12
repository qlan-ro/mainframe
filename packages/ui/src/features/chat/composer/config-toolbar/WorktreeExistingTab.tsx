'use client';

/**
 * WorktreeExistingTab — the "Existing" tab body and the tab-bar switcher,
 * extracted so WorktreePopover.tsx stays under 300 lines.
 */

import type { WorktreeEntry } from '@/lib/api/git';
import { MenuEmpty } from '@/components/ui/menu';

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

export type WorktreeTab = 'new' | 'existing';

interface TabBarProps {
  active: WorktreeTab;
  onChange: (t: WorktreeTab) => void;
}

export function WorktreeTabBar({ active, onChange }: TabBarProps) {
  return (
    <div className="flex items-center gap-[2px] rounded-[6px] bg-muted p-[2px]">
      <button
        type="button"
        data-testid="composer-worktree-tab-new"
        onClick={() => onChange('new')}
        className={[
          'flex-1 rounded-[5px] px-[8px] py-[2px] text-caption transition-colors',
          active === 'new'
            ? 'bg-popover font-medium text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        ].join(' ')}
      >
        New
      </button>
      <button
        type="button"
        data-testid="composer-worktree-tab-existing"
        onClick={() => onChange('existing')}
        className={[
          'flex-1 rounded-[5px] px-[8px] py-[2px] text-caption transition-colors',
          active === 'existing'
            ? 'bg-popover font-medium text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        ].join(' ')}
      >
        Existing
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Existing-worktrees list
// ---------------------------------------------------------------------------

export interface ExistingTabProps {
  worktrees: WorktreeEntry[];
  submitting: boolean;
  onAttach: (wt: WorktreeEntry) => void;
  error: string | null;
}

export function WorktreeExistingTab({ worktrees, submitting, onAttach, error }: ExistingTabProps) {
  if (worktrees.length === 0) {
    return <MenuEmpty>No existing worktrees found</MenuEmpty>;
  }

  return (
    <div className="max-h-[192px] overflow-y-auto">
      {worktrees.map((wt) => (
        <button
          key={wt.path}
          type="button"
          data-testid={`composer-worktree-attach-${wt.path}`}
          disabled={submitting}
          onClick={() => onAttach(wt)}
          className={[
            'flex w-full flex-col items-start gap-[1px] rounded-[6px] px-[8px] py-[6px]',
            'text-left transition-colors hover:bg-accent',
            'disabled:pointer-events-none disabled:opacity-40',
          ].join(' ')}
        >
          <span className="truncate font-mono text-caption text-foreground">
            {wt.branch ? wt.branch.replace('refs/heads/', '') : 'detached'}
          </span>
          <span className="truncate text-label text-muted-foreground">{wt.path}</span>
        </button>
      ))}
      {error && <p className="mt-[4px] px-[8px] text-label text-destructive">{error}</p>}
    </div>
  );
}
