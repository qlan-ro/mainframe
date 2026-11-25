'use client';

/**
 * The composer's model control: provider dot, model name, effort as a dimmed
 * suffix ("Opus 4.5 High", C5). While a turn runs the model is locked but the
 * label stays readable: `aria-disabled`, not `disabled`, so the tooltip that
 * says why still opens.
 */

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ProviderDot } from '@/features/shared/ProviderDot';
import { modelSelectionHint } from '@/lib/cli-model';
import { cn } from '@/lib/utils';
import { ComposerHint } from '../composer-card-context';
import { ModelMenu, activeModel, type ModelMenuProps } from './ModelMenu';
import { toolbarButton } from './toolbar-button';

export const MODEL_LOCKED_HINT = 'Model changes apply after this turn';

export interface ProviderModelSelectProps extends ModelMenuProps {
  /** True while a turn is running. */
  disabled: boolean;
  className?: string;
}

export function ProviderModelSelect({ disabled, className, ...menu }: ProviderModelSelectProps) {
  const [open, setOpen] = useState(false);
  if (menu.adapters.length === 0) return null;
  const { activeId, modelLabel, effortLabel } = activeModel(menu);
  const label = effortLabel != null ? `${modelLabel} ${effortLabel}` : modelLabel;
  const hint = disabled
    ? MODEL_LOCKED_HINT
    : modelSelectionHint(menu.model, menu.runningModel ?? null, menu.showCurrentModel ?? false);

  return (
    <DropdownMenu open={open && !disabled} onOpenChange={setOpen}>
      <ComposerHint label={hint}>
        <DropdownMenuTrigger
          asChild
          onPointerDown={(e) => disabled && e.preventDefault()}
          onKeyDown={(e) => disabled && e.key !== 'Tab' && e.preventDefault()}
        >
          <button
            type="button"
            data-testid="composer-model-select"
            aria-disabled={disabled || undefined}
            aria-label={`Provider and model: ${label}${disabled ? `. ${MODEL_LOCKED_HINT}` : ''}`}
            style={open && !disabled ? { pointerEvents: 'auto' } : undefined}
            className={toolbarButton(open && !disabled, className)}
          >
            <ProviderDot adapterId={activeId} testId="composer-model-provider-dot" />
            <span className="min-w-0 truncate">
              {modelLabel}
              {effortLabel != null && <span className="ml-1 text-muted-foreground">{effortLabel}</span>}
            </span>
            <ChevronDown className={cn('size-3 shrink-0 text-muted-foreground', disabled && 'hidden')} />
          </button>
        </DropdownMenuTrigger>
      </ComposerHint>
      <DropdownMenuContent
        data-testid="composer-provider-model-popover"
        align="start"
        side="top"
        sideOffset={6}
        className="w-62.5"
      >
        {open && !disabled && <ModelMenu {...menu} />}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
