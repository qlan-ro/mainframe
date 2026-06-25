/**
 * TasksFilterBar — search + type/priority/label filters + sort for Tasks.
 *
 * Composed from: search Input, FilterMenu (type/priority/labels), a Clear button,
 * and SortMenu. Props-driven; the store owns state via useTodosStore.
 *
 * Port of packages/app-electron/src/renderer/components/todos/TodoFilterBar.tsx,
 * rebuilt on app-tauri shadcn/ui + warm-chrome theme tokens.
 */
import React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import type { Todo, TodoType, TodoPriority } from '@/lib/api/todos';
import type { TodoFilters, TodoSort } from './todos-filters';
import { FilterMenu, type FilterOption } from './FilterMenu';
import { SortMenu } from './SortMenu';

interface Props {
  filters: TodoFilters;
  onChange: (f: TodoFilters) => void;
  allLabels: string[];
  sort: TodoSort;
  onSortChange: (s: TodoSort) => void;
  todos: Todo[];
}

const ALL_TYPES: TodoType[] = [
  'bug',
  'feature',
  'enhancement',
  'documentation',
  'question',
  'wont_fix',
  'duplicate',
  'invalid',
];
const ALL_PRIORITIES: TodoPriority[] = ['critical', 'high', 'medium', 'low'];

function countBy<T extends string>(todos: Todo[], key: keyof Pick<Todo, 'type' | 'priority'>): Map<T, number> {
  const map = new Map<T, number>();
  for (const t of todos) {
    const val = t[key] as T;
    map.set(val, (map.get(val) ?? 0) + 1);
  }
  return map;
}

function hasActiveFilters(f: TodoFilters): boolean {
  return f.types.length > 0 || f.priorities.length > 0 || f.labels.length > 0 || f.search.length > 0;
}

function buildTypeOptions(todos: Todo[], selected: string[]): FilterOption[] {
  const counts = countBy<TodoType>(todos, 'type');
  return ALL_TYPES.filter((t) => (counts.get(t) ?? 0) > 0 || selected.includes(t)).map((t) => ({
    value: t,
    label: t,
    count: counts.get(t) ?? 0,
  }));
}

function buildPriorityOptions(todos: Todo[], selected: string[]): FilterOption[] {
  const counts = countBy<TodoPriority>(todos, 'priority');
  return ALL_PRIORITIES.filter((p) => (counts.get(p) ?? 0) > 0 || selected.includes(p)).map((p) => ({
    value: p,
    label: p,
    count: counts.get(p) ?? 0,
  }));
}

function buildLabelOptions(todos: Todo[], allLabels: string[]): FilterOption[] {
  const counts = new Map<string, number>();
  for (const t of todos) {
    for (const l of t.labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return allLabels.map((l) => ({
    value: l,
    label: l,
    count: counts.get(l) ?? 0,
  }));
}

export function TasksFilterBar({ filters, onChange, allLabels, sort, onSortChange, todos }: Props): React.ReactElement {
  const active = hasActiveFilters(filters);

  const typeOptions = buildTypeOptions(todos, filters.types);
  const priorityOptions = buildPriorityOptions(todos, filters.priorities);
  const labelOptions = buildLabelOptions(todos, allLabels);

  const handleTypeChange = (types: string[]) => onChange({ ...filters, types: types as TodoType[] });
  const handlePriorityChange = (priorities: string[]) =>
    onChange({ ...filters, priorities: priorities as TodoPriority[] });
  const handleLabelChange = (labels: string[]) => onChange({ ...filters, labels });
  const clearAll = () => onChange({ types: [], priorities: [], labels: [], search: '' });

  return (
    <div className="px-3 py-2 border-b border-border bg-card shrink-0">
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        {/* Search input */}
        <div className="relative flex items-center">
          <Search size={12} className="absolute left-2 text-muted-foreground pointer-events-none" />
          <Input
            data-testid="tasks-filter-search"
            type="text"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            placeholder="Filter by title…"
            className="h-[30px] w-[230px] pl-6 pr-6 text-caption"
          />
          {filters.search && (
            <button
              onClick={() => onChange({ ...filters, search: '' })}
              className="absolute right-1.5 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X size={11} />
            </button>
          )}
        </div>

        {/* Type filter */}
        <FilterMenu label="Type" options={typeOptions} selected={filters.types} onChange={handleTypeChange} />

        {/* Priority filter */}
        <FilterMenu
          label="Priority"
          options={priorityOptions}
          selected={filters.priorities}
          onChange={handlePriorityChange}
        />

        {/* Labels filter (only when labels exist) */}
        {labelOptions.length > 0 && (
          <FilterMenu label="Label" options={labelOptions} selected={filters.labels} onChange={handleLabelChange} />
        )}

        {/* Clear button */}
        {active && (
          <button
            data-testid="tasks-filter-clear"
            onClick={clearAll}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-caption font-medium transition-colors',
              'text-primary hover:underline',
            )}
            type="button"
          >
            <X size={11} />
            Clear
          </button>
        )}

        {/* Sort menu — right-aligned */}
        <div className="ml-auto shrink-0">
          <SortMenu sort={sort} onChange={onSortChange} />
        </div>
      </div>
    </div>
  );
}
