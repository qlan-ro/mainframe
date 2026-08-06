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
import { ArrowUpDown } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@v2/components/ui/dropdown-menu';
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
        <Button variant="outline" size="sm" data-testid="tasks-sort-menu" className="text-muted-foreground">
          <ArrowUpDown />
          <span>
            {current?.label} {dirArrow(sort.dir)}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[172px]">
        <DropdownMenuRadioGroup value={sort.key} onValueChange={(v) => pick(v as TodoSortKey)}>
          {SORT_KEYS.map(({ key, label }) => (
            <DropdownMenuRadioItem
              key={key}
              value={key}
              data-testid={`tasks-sort-option-${key}`}
              onSelect={(e) => e.preventDefault()}
            >
              <span className="flex-1">{label}</span>
              {sort.key === key && <span className="text-primary">{dirArrow(sort.dir)}</span>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
