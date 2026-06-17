'use client';

/**
 * PlanModeToggle — ClipboardList icon + "Plan" label toggle button.
 *
 * Renders NULL unless the adapter declares `capabilities.planMode = true`.
 * NOT disabled while the chat is running — planMode changes take effect on the
 * next user turn.
 *
 * Active styling uses bg-mf-selection + text-primary to avoid the
 * /opacity-on-token trap.
 *
 * Built on shadcn Tooltip; never raw Radix.
 */

import { ClipboardList } from 'lucide-react';
import type { AdapterInfo, Chat } from '@qlan-ro/mainframe-types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="composer-plan-toggle"
          aria-label={active ? 'Plan mode: on — click to disable' : 'Plan mode: off — click to enable'}
          aria-pressed={active}
          onClick={() => setPlanMode(!active)}
          className={[
            'flex items-center gap-1 px-2 py-1',
            'rounded-md border text-label',
            'transition-colors',
            'focus-visible:outline-none',
            active
              ? 'border-mf-warning bg-mf-warning-tint text-mf-warning'
              : 'border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          ].join(' ')}
        >
          <ClipboardList size={14} className="shrink-0" />
          <span className="text-label font-medium">Plan</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{active ? 'Plan mode: on' : 'Plan mode: off'}</TooltipContent>
    </Tooltip>
  );
}
