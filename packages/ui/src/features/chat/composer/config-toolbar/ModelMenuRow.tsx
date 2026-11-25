'use client';

/**
 * ModelMenuRow — one model in the composer's model menu. Effort and the
 * model's options are the menu's own section below the list (`ModelTuning`).
 */

import { Check } from 'lucide-react';
import type { AdapterModel } from '@qlan-ro/mainframe-types';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface ModelMenuRowProps {
  option: AdapterModel;
  active: boolean;
  onSelect: (id: string) => void;
}

function rowDescription(option: AdapterModel): string | undefined {
  if (!option.isDefault || option.id === 'default') return option.description;
  return option.description ? `${option.description} · default` : 'default';
}

export function ModelMenuRow({ option, active, onSelect }: ModelMenuRowProps) {
  const desc = rowDescription(option);
  return (
    <DropdownMenuItem
      data-testid={`composer-model-select-option-${option.id}`}
      aria-label={active ? `${option.label}, selected` : option.label}
      className="items-start"
      onSelect={() => onSelect(option.id)}
    >
      <Check className={cn('mt-0.5 size-3.5 shrink-0 text-primary', !active && 'invisible')} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{option.label}</span>
        {desc && <span className="block text-xs leading-snug text-muted-foreground">{desc}</span>}
      </span>
    </DropdownMenuItem>
  );
}
