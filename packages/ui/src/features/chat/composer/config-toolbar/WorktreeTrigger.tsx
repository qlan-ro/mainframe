'use client';

/**
 * WorktreeTrigger — the composer chip that opens WorktreePopover: the isolated
 * / pending-isolation corner dot, and a disabled state with an explanation for
 * a no-project chat/draft or a temporary chat/draft (todo #346), neither of
 * which ever opens the popover.
 *
 * The temporary-disabled state uses `aria-disabled` + a click guard, not the
 * native `disabled` attribute (mirroring TemporaryToggle):
 * native `disabled` pairs with `disabled:pointer-events-none` below, which
 * suppresses the Hint tooltip too — right when its "Worktrees aren't available
 * for temporary chats" label matters most. The no-project-disabled state keeps
 * native `disabled` (unchanged): a no-project chat is never expected to grow a
 * worktree later, so there is nothing time-sensitive about that explanation.
 */
import { FolderGit2 } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface WorktreeTriggerProps {
  noProjectDisabled: boolean;
  /** Temporary and worktree are mutually exclusive (todo #346). */
  temporaryDisabled: boolean;
  showIsolated: boolean;
  branchLabel: string | null;
}

export function WorktreeTrigger({
  noProjectDisabled,
  temporaryDisabled,
  showIsolated,
  branchLabel,
}: WorktreeTriggerProps) {
  // Temporary-disabled: aria-disabled + a click guard (below), so the Hint
  // tooltip stays interactive — see the module docstring. No-project-
  // disabled keeps the native attribute; nothing time-sensitive there.
  const locked = temporaryDisabled;
  const nativeDisabled = noProjectDisabled && !temporaryDisabled;
  const label = temporaryDisabled
    ? 'Worktrees aren’t available for temporary chats'
    : noProjectDisabled
      ? 'No project — worktrees aren’t available'
      : showIsolated
        ? `Worktree: ${branchLabel}`
        : 'Isolate session in a worktree';
  const ariaLabel = temporaryDisabled
    ? 'Worktrees unavailable — temporary chat'
    : noProjectDisabled
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
          disabled={nativeDisabled}
          aria-disabled={locked || undefined}
          aria-label={ariaLabel}
          onClick={(e) => {
            // Blocks Radix's own composed onOpenToggle (it checks
            // defaultPrevented) without suppressing pointer events, so the
            // Hint tooltip above keeps working while locked.
            if (locked) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          // Geometry matches its untouched neighbours in the config chip row
          // (PermissionSelect / PlanModeToggle); only the tokens moved to v2.
          className={cn(
            'relative flex h-[20px] w-[26px] shrink-0 items-center justify-center gap-[3px]',
            'rounded-sm border text-muted-foreground',
            showIsolated ? 'border-success text-success' : 'border-border',
            'hover:bg-accent hover:text-accent-foreground',
            'data-[state=open]:border-primary data-[state=open]:bg-sidebar-selection',
            'transition-colors focus-visible:outline-none',
            'disabled:pointer-events-none disabled:opacity-50',
            locked && 'cursor-default opacity-50',
          )}
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
