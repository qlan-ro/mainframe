'use client';

/**
 * AdapterSelect — compact DropdownMenu to pick the chat's agent (Claude /
 * Gemini / Codex / OpenCode).
 *
 * Renders NULL when 0 or 1 adapters are registered (nothing to choose). The
 * agent can only be chosen on a fresh session: once the chat has messages it is
 * DISABLED (mirrors the desktop invariant — switching agents mid-thread would
 * orphan the CLI session).
 *
 * Built on shadcn DropdownMenu; never raw Radix.
 * Token rule: no /opacity modifier on hex CSS-var colors.
 */

import type { AdapterInfo, Chat } from '@qlan-ro/mainframe-types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface AdapterSelectProps {
  chat: Chat;
  adapters: AdapterInfo[];
  /** True once the chat has any messages — locks the agent for the session. */
  locked: boolean;
  setAdapter: (adapterId: string) => void;
}

export function AdapterSelect({ chat, adapters, locked, setAdapter }: AdapterSelectProps) {
  // Nothing to pick when there is only one (or zero) registered adapter.
  if (adapters.length <= 1) return null;

  const currentId = chat.adapterId ?? '';
  const triggerLabel = adapters.find((a) => a.id === currentId)?.name ?? currentId;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild disabled={locked}>
            <button
              type="button"
              data-testid="composer-adapter-select"
              aria-label={`Agent: ${triggerLabel}`}
              disabled={locked}
              className={[
                'flex items-center gap-1 px-2 py-1',
                'rounded-md text-label text-muted-foreground',
                'hover:bg-accent hover:text-accent-foreground',
                'transition-colors',
                'focus-visible:outline-none',
                'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
              ].join(' ')}
            >
              <span className="text-label font-medium">{triggerLabel}</span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          {locked ? 'Agent is locked once the chat has messages' : 'Switch agent'}
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="start" side="top" sideOffset={6} className="min-w-48">
        {adapters.map((option) => (
          <DropdownMenuItem
            key={option.id}
            data-testid={`composer-adapter-select-option-${option.id}`}
            onSelect={() => setAdapter(option.id)}
            className={option.id === currentId ? 'bg-accent text-accent-foreground font-medium' : ''}
          >
            {option.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
