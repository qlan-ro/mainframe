/**
 * SortMenu — dropdown for choosing sort key + direction for the Tasks surface.
 *
 * Single-toggle-per-key interaction model (design: TdSortMenu,
 * 12-todos.jsx:246-282, finding 9.11): one row per key. Clicking the
 * already-active key's row toggles its direction in place; clicking a
 * different key switches to it with a sensible default direction
 * (asc for priority/type, desc otherwise).
 */
import React from 'react';
import { ArrowUpDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import type { TodoSort, TodoSortKey } from './todos-filters';

interface Props {
  sort: TodoSort;
  onChange: (sort: TodoSort) => void;
}

const SORT_KEYS: { key: TodoSortKey; label: string }[] = [
  { key: 'priority', label: 'Priority' },
  { key: 'number', label: 'Number' },
  { key: 'updated', label: 'Last updated' },
  { key: 'type', label: 'Type' },
];

// priority/type default to ascending on first pick; everything else descending.
function defaultDirFor(key: TodoSortKey): TodoSort['dir'] {
  return key === 'priority' || key === 'type' ? 'asc' : 'desc';
}

function dirArrow(dir: TodoSort['dir']): string {
  return dir === 'desc' ? '↓' : '↑';
}

export function SortMenu({ sort, onChange }: Props): React.ReactElement {
  const current = SORT_KEYS.find((k) => k.key === sort.key) ?? SORT_KEYS[0];

  function pick(key: TodoSortKey) {
    if (sort.key === key) onChange({ key, dir: sort.dir === 'desc' ? 'asc' : 'desc' });
    else onChange({ key, dir: defaultDirFor(key) });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          data-testid="tasks-sort-menu"
          type="button"
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded text-label font-medium transition-colors',
            'border border-border bg-background text-muted-foreground hover:text-foreground',
          )}
        >
          <ArrowUpDown size={11} />
          <span>
            {current?.label} {dirArrow(sort.dir)}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[172px] p-1">
        {SORT_KEYS.map(({ key, label }) => {
          const active = sort.key === key;
          return (
            <DropdownMenuItem
              key={key}
              data-testid={`tasks-sort-option-${key}`}
              aria-selected={active}
              onSelect={() => pick(key)}
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 text-body cursor-pointer rounded',
                active && 'font-semibold text-primary',
              )}
            >
              <span className="w-3.5 shrink-0">
                {active && <Check size={11} strokeWidth={2.5} className="text-primary" />}
              </span>
              <span className="flex-1">{label}</span>
              {active && <span className="text-primary">{dirArrow(sort.dir)}</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
