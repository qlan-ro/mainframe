'use client';

/**
 * ModelMenuRow — one model in the composer's model menu. Effort and the
 * model's options are the menu's own section below the list (`ModelTuning`).
 */

import { Check } from 'lucide-react';
import type { AdapterModel } from '@qlan-ro/mainframe-types';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';

export interface ModelMenuRowProps {
  option: AdapterModel;
  active: boolean;
  onSelect: (id: string) => boolean;
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
      onSelect={(event) => {
        if (onSelect(option.id)) event.preventDefault();
      }}
    >
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{option.label}</span>
        {desc && <span className="block text-meta/[1.35] font-normal text-muted-foreground">{desc}</span>}
      </span>
      {active && (
        <span className="flex h-5 shrink-0 items-center">
          <Check className="size-4 text-ink-secondary" />
        </span>
      )}
    </DropdownMenuItem>
  );
}
