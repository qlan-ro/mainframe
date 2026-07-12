/**
 * FilterMenu — generic multi-select dropdown for the Tasks filter bar.
 *
 * Renders a shadcn DropdownMenu with checkboxes for each option.
 * Shows per-option counts and highlights the trigger when any option is selected.
 *
 * Used by TasksFilterBar for Type, Priority, and Label filters.
 */
import React from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CountBadge } from '@/components/ui/count-badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

export interface FilterOption {
  value: string;
  label: string;
  count: number;
}

interface Props {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

function toggleValue(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

/** Convert a label to a kebab-case testid segment. */
function toKebab(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-');
}

export function FilterMenu({ label, options, selected, onChange }: Props): React.ReactElement {
  const hasSelection = selected.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          data-testid={`tasks-filter-${toKebab(label)}`}
          type="button"
          className={cn(
            'flex items-center gap-1 rounded-md border-[0.5px] px-2 py-1 text-label font-medium transition-colors',
            hasSelection
              ? 'border-transparent bg-primary/10 text-primary'
              : 'border-border bg-background text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
          {hasSelection && (
            <CountBadge
              count={selected.length}
              variant="unread"
              className="ml-0.5"
              data-testid={`tasks-filter-${toKebab(label)}-count`}
            />
          )}
          <ChevronDown size={12} className="ml-0.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px] max-h-64 overflow-y-auto p-1">
        {options.map((opt) => {
          const isSelected = selected.includes(opt.value);
          return (
            <DropdownMenuItem
              key={opt.value}
              data-testid={`tasks-filter-opt-${opt.value}`}
              onSelect={(e) => {
                e.preventDefault();
                onChange(toggleValue(selected, opt.value));
              }}
              className="flex items-center gap-2 px-2 py-1.5 rounded text-body cursor-pointer"
            >
              {/* Checkbox indicator */}
              <span
                className={cn(
                  'w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0',
                  isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-border',
                )}
              >
                {isSelected && <Check size={12} strokeWidth={3} />}
              </span>
              <span className="flex-1 capitalize">{opt.label.replace('_', ' ')}</span>
              {opt.count > 0 && <span className="text-caption text-muted-foreground tabular-nums">{opt.count}</span>}
            </DropdownMenuItem>
          );
        })}
        {options.length === 0 && (
          <div className="px-2 py-2 text-caption text-muted-foreground text-center">No options</div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
