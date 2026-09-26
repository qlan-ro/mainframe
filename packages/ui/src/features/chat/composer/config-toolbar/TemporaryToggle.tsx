'use client';

/**
 * TemporaryToggle — Timer icon + chip chrome toggle for a create-time-only flag
 * (todo #346): a temporary chat is excluded from default listings and deleted
 * (never archived) when closed.
 *
 * Three states:
 *  - draft (no daemon chat yet): interactive — toggles `DraftCfg.temporary`.
 *  - real chat, `chat.temporary === true`: engaged but locked — the flag is
 *    fixed at creation, so it renders `aria-disabled` rather than nothing.
 *  - real chat, `chat.temporary === false`: renders null — nothing to show or
 *    toggle once the chat is not (and can never become) temporary.
 *
 * A draft with a worktree attached (`chat.worktreePath`, or a "New" worktree
 * staged in `pendingWorktree`) also locks the chip, off, with its own hint —
 * Temporary and worktree are mutually exclusive (todo #346): the
 * daemon discard only removes the chat's scratch path, so a temporary chat
 * with a worktree would orphan it.
 *
 * `aria-disabled`, not the native `disabled` attribute: a disabled button
 * suppresses pointer events, which would kill the Hint tooltip on the locked
 * real-chat state right when a label explaining the lock matters most.
 *
 * Chip chrome mirrors PlanModeToggle — hand-rolled for the same reason (the
 * Hint's `TooltipTrigger asChild` overwrites `data-state`, so chrome is driven
 * off `active` instead of a `data-[state=on]:*` variant).
 */

import { Timer } from 'lucide-react';
import type { Chat } from '@qlan-ro/mainframe-types';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import { useDraftConfig } from '@/features/sessions/runtime/draft-config';

export interface TemporaryToggleProps {
  chat: Chat;
  draftMode: boolean;
  setTemporary: (on: boolean) => void;
}

export function TemporaryToggle({ chat, draftMode, setTemporary }: TemporaryToggleProps) {
  const isLocalDraft = chat.id.startsWith('__LOCALID_');
  const draft = useDraftConfig(isLocalDraft ? chat.id : null);
  const hasWorktree = chat.worktreePath != null || draft?.pendingWorktree != null;
  const active = chat.temporary === true;
  // A real, non-temporary chat: the flag is create-time only, nothing to show.
  if (!draftMode && !active) return null;

  const locked = !draftMode || hasWorktree;
  const hintLabel = hasWorktree
    ? 'Not available with a worktree'
    : !draftMode || active
      ? 'Temporary — deleted when closed'
      : 'Temporary chat: off';

  return (
    <Hint label={hintLabel} side="top">
      <button
        type="button"
        data-testid="composer-temporary-toggle"
        aria-label="Temporary chat"
        aria-pressed={active}
        aria-disabled={locked || undefined}
        onClick={() => {
          if (!locked) setTemporary(!active);
        }}
        className={cn(
          'flex h-[20px] w-[26px] shrink-0 items-center justify-center',
          'rounded-sm border-[0.5px] text-xs',
          'transition-colors',
          'focus-visible:outline-none',
          active
            ? 'border-primary bg-sidebar-selection text-primary'
            : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          locked && 'cursor-default',
          // Only suppress the hover fill when there's no engaged chrome to
          // protect — locked+active (a real temporary chat) must keep its
          // bg-sidebar-selection stable on hover, not flash to transparent
          //.
          locked && !active && 'hover:bg-transparent',
        )}
      >
        <Timer size={12} className="shrink-0" />
      </button>
    </Hint>
  );
}
