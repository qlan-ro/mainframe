/**
 * FilterMenu — generic multi-select dropdown for the Tasks filter bar.
 *
 * Renders a shadcn DropdownMenu with checkboxes for each option.
 * Shows per-option counts and highlights the trigger when any option is selected.
 *
 * Used by TasksFilterBar for Type, Priority, and Label filters.
 */
import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
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
        <Button
          variant="outline"
          size="sm"
          data-testid={`tasks-filter-${toKebab(label)}`}
          className={cn(hasSelection && 'border-transparent bg-primary/10 text-primary hover:bg-primary/15')}
        >
          {label}
          {hasSelection && (
            <Badge
              variant="secondary"
              className="px-1 py-0 text-xs tabular-nums"
              data-testid={`tasks-filter-${toKebab(label)}-count`}
            >
              {selected.length}
            </Badge>
          )}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 min-w-[160px] overflow-y-auto">
        {options.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt.value}
            data-testid={`tasks-filter-opt-${opt.value}`}
            checked={selected.includes(opt.value)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onChange(toggleValue(selected, opt.value))}
          >
            <span className="flex-1 capitalize">{opt.label.replace('_', ' ')}</span>
            {opt.count > 0 && <span className="text-xs tabular-nums text-muted-foreground">{opt.count}</span>}
          </DropdownMenuCheckboxItem>
        ))}
        {options.length === 0 && <div className="px-2 py-2 text-center text-xs text-muted-foreground">No options</div>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
