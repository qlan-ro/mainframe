/**
 * SessionSortMenu — the "Sort By" popover triggered by the chevron-up-down
 * button in the Sessions header.
 *
 * Lists the SESSION_SORTS options (Recent activity / Name (A–Z) / Status) under a
 * "SORT BY" eyebrow, with a checkmark on the active option. Selecting an option
 * fires onChange and closes the popover. Matches the 02-chrome artboard sort
 * popover (rounded, shadow, eyebrow).
 */
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ArrowUpDown } from 'lucide-react';
import { MenuLabel, MenuSelectRow } from '@/components/ui/menu';
import { Hint } from '@/components/ui/hint';
import { SESSION_SORTS, type SortMode } from '../view-model/group-sessions';

interface SessionSortMenuProps {
  mode: SortMode;
  onChange: (mode: SortMode) => void;
}

export function SessionSortMenu({ mode, onChange }: SessionSortMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint label="Sort sessions">
        <PopoverTrigger asChild>
          <button
            data-testid="sessions-sort-button"
            type="button"
            className="inline-flex size-[22px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
          >
            <ArrowUpDown className="size-3.5" />
          </button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent data-testid="sessions-sort-popover" align="end" sideOffset={6} className="w-44">
        <MenuLabel>Sort by</MenuLabel>
        {SESSION_SORTS.map((sort) => (
          <MenuSelectRow
            key={sort.id}
            data-testid={`sessions-sort-${sort.id}`}
            selected={sort.id === mode}
            label={sort.label}
            onClick={() => {
              onChange(sort.id);
              setOpen(false);
            }}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}
