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
  inactive: boolean;
  onSelect: (id: string) => boolean;
}

function rowDescription(option: AdapterModel): string | undefined {
  if (!option.isDefault || option.id === 'default') return option.description;
  return option.description ? `${option.description} · default` : 'default';
}

export function ModelMenuRow({ option, active, inactive, onSelect }: ModelMenuRowProps) {
  const desc = rowDescription(option);
  return (
    <DropdownMenuItem
      data-testid={`composer-model-select-option-${option.id}`}
      aria-label={active ? `${option.label}, selected` : option.label}
      aria-disabled={inactive || undefined}
      className="items-start aria-disabled:opacity-50"
      onPointerMove={(event) => {
        if (inactive) event.preventDefault();
      }}
      onPointerDown={(event) => {
        if (inactive) event.preventDefault();
      }}
      onPointerLeave={(event) => {
        if (inactive) event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (inactive && event.key !== 'Escape' && event.key !== 'Tab') {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onSelect={(event) => {
        if (inactive) event.preventDefault();
        else if (onSelect(option.id)) {
          event.preventDefault();
          (event.target as HTMLElement).focus();
        }
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
