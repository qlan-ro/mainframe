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
import { ChevronsUpDownIcon, CheckIcon } from 'lucide-react';
import { SESSION_SORTS, type SortMode } from '../view-model/group-sessions';

interface SessionSortMenuProps {
  mode: SortMode;
  onChange: (mode: SortMode) => void;
}

export function SessionSortMenu({ mode, onChange }: SessionSortMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          data-testid="sessions-sort-button"
          type="button"
          title="Sort sessions"
          className="inline-flex size-[22px] items-center justify-center rounded-md text-mf-text-3 transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          <ChevronsUpDownIcon className="size-[11px]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-44 p-1.5">
        <div className="px-2 pb-1.5 pt-1 text-[9.5px] font-bold uppercase tracking-[0.06em] text-mf-text-3">
          Sort by
        </div>
        {SESSION_SORTS.map((sort) => {
          const active = sort.id === mode;
          return (
            <button
              key={sort.id}
              data-testid={`sessions-sort-${sort.id}`}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              onClick={() => {
                onChange(sort.id);
                setOpen(false);
              }}
              className={[
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body transition-colors',
                active ? 'bg-accent font-semibold text-foreground' : 'font-medium text-foreground hover:bg-accent',
              ].join(' ')}
            >
              <span className="inline-flex w-[13px] flex-shrink-0 justify-center">
                {active && <CheckIcon className="size-3 text-primary" strokeWidth={2.5} />}
              </span>
              {sort.label}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
