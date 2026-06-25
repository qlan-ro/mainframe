/**
 * SortMenu — dropdown for choosing sort key and direction for the Tasks surface.
 *
 * Renders a shadcn DropdownMenu. Each (key, dir) combination is an option.
 * The active combination gets a checkmark.
 *
 * Sort keys: number | priority | type. Directions: asc | desc.
 */
import React from 'react';
import { ArrowUpDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { TodoSort, TodoSortKey } from './todos-filters';

interface Props {
  sort: TodoSort;
  onChange: (sort: TodoSort) => void;
}

const SORT_KEYS: { key: TodoSortKey; label: string }[] = [
  { key: 'number', label: '#' },
  { key: 'priority', label: 'Priority' },
  { key: 'type', label: 'Type' },
  { key: 'updated', label: 'Last updated' },
];

function activeSortLabel(sort: TodoSort): string {
  const keyLabel = SORT_KEYS.find((k) => k.key === sort.key)?.label ?? sort.key;
  return `${keyLabel} ${sort.dir === 'asc' ? '↑' : '↓'}`;
}

export function SortMenu({ sort, onChange }: Props): React.ReactElement {
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
          <span>{activeSortLabel(sort)}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px] p-1">
        {SORT_KEYS.map(({ key, label }, idx) => (
          <React.Fragment key={key}>
            {idx > 0 && <DropdownMenuSeparator className="my-1" />}
            <div className="px-2 py-1 text-caption text-muted-foreground font-medium">{label}</div>
            <DropdownMenuItem
              data-testid={`tasks-sort-${key}-asc`}
              onSelect={() => onChange({ key, dir: 'asc' })}
              className="flex items-center gap-2 px-2 py-1.5 text-body cursor-pointer rounded"
            >
              <span className="w-3.5 shrink-0">
                {sort.key === key && sort.dir === 'asc' && (
                  <Check size={12} strokeWidth={2.5} className="text-primary" />
                )}
              </span>
              <span>↑ Ascending</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid={`tasks-sort-${key}-desc`}
              onSelect={() => onChange({ key, dir: 'desc' })}
              className="flex items-center gap-2 px-2 py-1.5 text-body cursor-pointer rounded"
            >
              <span className="w-3.5 shrink-0">
                {sort.key === key && sort.dir === 'desc' && (
                  <Check size={12} strokeWidth={2.5} className="text-primary" />
                )}
              </span>
              <span>↓ Descending</span>
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
