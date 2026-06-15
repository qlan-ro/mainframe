'use client';

/**
 * EffortPicker — gauge-icon trigger + dropdown of supported effort levels.
 *
 * Renders NULL when the model exposes no effort control (e.g. Haiku).
 * Disabled while the chat is running OR when ultracode locks the effort to xhigh.
 *
 * Built on shadcn DropdownMenu (not raw Radix) per the component-map contract.
 * Uses real mf-* tokens and opaque rgba for opacity; never the /opacity modifier.
 */

import { Gauge } from 'lucide-react';
import type { AdapterModel, Chat, EffortLevel, ProviderConfig } from '@qlan-ro/mainframe-types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { effortOptions, displayEffort } from '@/lib/model-tuning';

export interface EffortPickerProps {
  chat: Chat;
  model: AdapterModel;
  setEffort: (effort: EffortLevel) => void;
  disabled: boolean;
  providerDefaults?: ProviderConfig;
}

/** Trigger label shown inside the button. */
function EffortLabel({ value }: { value: string }) {
  return <span className="text-label font-medium">{value}</span>;
}

export function EffortPicker({ chat, model, setEffort, disabled, providerDefaults }: EffortPickerProps) {
  const options = effortOptions(model);

  // Hidden when the model has no effort control.
  if (options.length === 0) return null;

  const { value: current, locked } = displayEffort(chat, model, providerDefaults);
  const isDisabled = disabled || locked;

  const selectedOption = options.find((o) => o.id === current);
  const triggerLabel = selectedOption?.label ?? current;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="composer-effort-select"
              disabled={isDisabled}
              aria-label={`Effort: ${triggerLabel}`}
              className={[
                'flex items-center gap-1 px-2 py-1',
                'rounded-md text-label text-muted-foreground',
                'hover:bg-accent hover:text-accent-foreground',
                'transition-colors',
                'disabled:pointer-events-none',
                'disabled:opacity-40',
                'focus-visible:outline-none',
              ].join(' ')}
            >
              <Gauge size={14} className="shrink-0" />
              <EffortLabel value={triggerLabel} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{locked ? 'Effort locked by Ultracode' : 'Reasoning effort'}</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="start" side="top" sideOffset={6} className="min-w-40">
        {options.map((option) => (
          <Tooltip key={option.id}>
            <TooltipTrigger asChild>
              <DropdownMenuItem
                data-testid={`composer-effort-select-option-${option.id}`}
                onSelect={() => setEffort(option.id as EffortLevel)}
                className={option.id === current ? 'bg-accent text-accent-foreground font-medium' : ''}
              >
                {option.label}
              </DropdownMenuItem>
            </TooltipTrigger>
            {option.description ? <TooltipContent side="right">{option.description}</TooltipContent> : null}
          </Tooltip>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
