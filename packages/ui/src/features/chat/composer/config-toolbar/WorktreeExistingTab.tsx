'use client';

/**
 * WorktreeExistingTab — the "Existing" tab body, the tab-bar switcher and the
 * popover's shared section label, extracted so WorktreePopover.tsx stays under
 * 300 lines.
 */

import type { ReactNode } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@v2/components/ui/tabs';
import type { WorktreeEntry } from '@/lib/api/git';

/**
 * Section eyebrow inside the popover — the same rung GateHead's eyebrow uses.
 * Replaces the v1 `MenuLabel`, which belonged to a menu this surface is not.
 */
export function WorktreeSectionLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 text-xs font-medium text-muted-foreground">{children}</div>;
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

export type WorktreeTab = 'new' | 'existing';

interface TabBarProps {
  active: WorktreeTab;
  onChange: (t: WorktreeTab) => void;
}

/**
 * A one-of-N switch is Radix `Tabs` (List + Trigger, no TabsContent — the body
 * below is the caller's). Full-width rather than the chrome-row `Segmented`
 * recipe: this fills a 288px popover. `activationMode="manual"` because
 * `onChange` writes, and automatic activation also fires on focus.
 *
 * Compacted to 28px by re-declaring the primitive's OWN group modifier, so
 * tailwind-merge replaces the height instead of stacking a second one.
 */
export function WorktreeTabBar({ active, onChange }: TabBarProps) {
  return (
    <Tabs value={active} onValueChange={(v) => onChange(v as WorktreeTab)} activationMode="manual">
      <TabsList className="w-full group-data-horizontal/tabs:h-7">
        <TabsTrigger value="new" data-testid="composer-worktree-tab-new" className="text-xs">
          New
        </TabsTrigger>
        <TabsTrigger value="existing" data-testid="composer-worktree-tab-existing" className="text-xs">
          Existing
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Existing-worktrees list
// ---------------------------------------------------------------------------

export interface ExistingTabProps {
  worktrees: WorktreeEntry[];
  /** Withhold the attach rows without hiding them (submit in flight, or a turn is). */
  disabled: boolean;
  onAttach: (wt: WorktreeEntry) => void;
  error: string | null;
}

export function WorktreeExistingTab({ worktrees, disabled, onAttach, error }: ExistingTabProps) {
  if (worktrees.length === 0) {
    return <p className="px-2 py-4 text-center text-xs text-muted-foreground">No existing worktrees found</p>;
  }

  return (
    <div className="max-h-48 overflow-y-auto">
      {worktrees.map((wt) => (
        // Not a Button: a two-line left-aligned row is a different shape than
        // any Button size, and `whitespace-nowrap` would fight the path line.
        <button
          key={wt.path}
          type="button"
          data-testid={`composer-worktree-attach-${wt.path}`}
          disabled={disabled}
          onClick={() => onAttach(wt)}
          className="flex w-full min-w-0 flex-col items-start rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
        >
          <span className="max-w-full truncate text-sm text-foreground">
            {wt.branch ? wt.branch.replace('refs/heads/', '') : 'detached'}
          </span>
          <span className="max-w-full truncate text-xs text-muted-foreground">{wt.path}</span>
        </button>
      ))}
      {error && <p className="mt-1 px-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
