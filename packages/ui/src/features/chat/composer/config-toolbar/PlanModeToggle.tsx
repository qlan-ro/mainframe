'use client';

/**
 * PlanModeToggle — Clipboard icon + "Plan" label toggle button.
 *
 * Renders NULL unless the adapter declares `capabilities.planMode = true`.
 * NOT disabled while the chat is running — planMode changes take effect on the
 * next user turn.
 *
 * Engaged chrome is the chip family's own — `border-primary bg-sidebar-selection
 * text-primary`, not amber. Plan mode is a MODE the user chose, and the safer one
 * at that; v2's `warning` means wrong-but-not-broken and the bridge's amber means
 * caution, so both read as a problem where there is none.
 *
 * Hand-rolled rather than a v2 `Toggle`: the Hint's `TooltipTrigger asChild`
 * overwrites the child's `data-state`, so `data-[state=on]:*` would be dead and
 * re-specified here anyway (same reason as PlanExecModeControl). Chrome is driven
 * off `active`; `aria-pressed` carries the state to tests and AT.
 */

import { Clipboard } from 'lucide-react';
import type { AdapterInfo, Chat } from '@qlan-ro/mainframe-types';
import { Hint } from '@v2/components/ui/hint';
import { cn } from '@/lib/utils';

export interface PlanModeToggleProps {
  chat: Chat;
  adapter: AdapterInfo;
  setPlanMode: (on: boolean) => void;
}

export function PlanModeToggle({ chat, adapter, setPlanMode }: PlanModeToggleProps) {
  // Hidden when the adapter does not support plan mode.
  if (!adapter.capabilities.planMode) return null;

  const active = chat.planMode === true;

  return (
    <Hint label={active ? 'Plan mode: on' : 'Plan mode: off'} side="top">
      <button
        type="button"
        data-testid="composer-plan-toggle"
        aria-label={active ? 'Plan mode: on — click to disable' : 'Plan mode: off — click to enable'}
        aria-pressed={active}
        onClick={() => setPlanMode(!active)}
        className={cn(
          'flex h-[20px] w-[26px] shrink-0 items-center justify-center',
          'rounded-sm border-[0.5px] text-xs',
          'transition-colors',
          'focus-visible:outline-none',
          active
            ? 'border-primary bg-sidebar-selection text-primary'
            : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <Clipboard size={12} className="shrink-0" />
      </button>
    </Hint>
  );
}
