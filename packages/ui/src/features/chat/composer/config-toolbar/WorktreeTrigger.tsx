'use client';

/**
 * WorktreeTrigger — the composer chip that opens WorktreePopover: the isolated
 * / pending-isolation corner dot, and a disabled state with an explanation for
 * a no-project chat or draft (todo #346), which never opens the popover.
 */
import { FolderGit2 } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { PopoverTrigger } from '@/components/ui/popover';

export interface WorktreeTriggerProps {
  noProjectDisabled: boolean;
  showIsolated: boolean;
  branchLabel: string | null;
}

export function WorktreeTrigger({ noProjectDisabled, showIsolated, branchLabel }: WorktreeTriggerProps) {
  const label = noProjectDisabled
    ? 'No project — worktrees aren’t available'
    : showIsolated
      ? `Worktree: ${branchLabel}`
      : 'Isolate session in a worktree';
  const ariaLabel = noProjectDisabled
    ? 'Worktrees unavailable — no project'
    : showIsolated
      ? `Worktree: ${branchLabel}`
      : 'Isolate in worktree';

  return (
    // Hint WRAPS the PopoverTrigger — inside it, TooltipTrigger's asChild
    // would clobber the trigger's own data-state.
    <Hint label={label} side="top">
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="composer-worktree-trigger"
          disabled={noProjectDisabled}
          aria-label={ariaLabel}
          // Geometry matches its untouched neighbours in the config chip row
          // (PermissionSelect / PlanModeToggle); only the tokens moved to v2.
          className={[
            'relative flex h-[20px] w-[26px] shrink-0 items-center justify-center gap-[3px]',
            'rounded-sm border text-muted-foreground',
            showIsolated ? 'border-success text-success' : 'border-border',
            'hover:bg-accent hover:text-accent-foreground',
            'data-[state=open]:border-primary data-[state=open]:bg-sidebar-selection',
            'transition-colors focus-visible:outline-none',
            'disabled:pointer-events-none disabled:opacity-50',
          ].join(' ')}
        >
          <FolderGit2 size={13} />
          {showIsolated && (
            <span className="absolute top-0.5 right-0.5 size-[5px] rounded-full bg-primary" aria-hidden />
          )}
        </button>
      </PopoverTrigger>
    </Hint>
  );
}
