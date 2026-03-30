import React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Todo, TodoType, TodoPriority } from '../../lib/api/todos-api';

export interface TodoFilters {
  types: TodoType[];
  priorities: TodoPriority[];
  labels: string[];
  search: string;
}

const TYPES: TodoType[] = ['bug', 'feature', 'enhancement', 'documentation', 'question'];
const PRIORITIES: TodoPriority[] = ['critical', 'high', 'medium', 'low'];

const chipBase = 'px-1.5 py-0.5 rounded text-mf-status cursor-pointer select-none transition-colors';
const chipOff = 'bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary';
const chipOn = 'bg-mf-accent/20 text-mf-accent';

interface Props {
  filters: TodoFilters;
  onChange: (f: TodoFilters) => void;
  allLabels: string[];
}

function toggleItem<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter((v) => v !== item) : [...arr, item];
}

function hasActiveFilters(f: TodoFilters): boolean {
  return f.types.length > 0 || f.priorities.length > 0 || f.labels.length > 0 || f.search.length > 0;
}

/** Extract unique labels from all todos. */
export function extractAllLabels(todos: Todo[]): string[] {
  const set = new Set<string>();
  for (const t of todos) {
    for (const l of t.labels) set.add(l);
  }
  return [...set].sort();
}

/** Check if a todo matches the current filters. */
export function matchesFilters(todo: Todo, f: TodoFilters): boolean {
  if (f.types.length > 0 && !f.types.includes(todo.type)) return false;
  if (f.priorities.length > 0 && !f.priorities.includes(todo.priority)) return false;
  if (f.labels.length > 0 && !f.labels.some((l) => todo.labels.includes(l))) return false;
  if (f.search && !todo.title.toLowerCase().includes(f.search.toLowerCase())) return false;
  return true;
}

function ChipGroup<T extends string>({
  items,
  selected,
  onToggle,
}: {
  items: T[];
  selected: T[];
  onToggle: (item: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onToggle(item)}
          className={cn(chipBase, selected.includes(item) ? chipOn : chipOff)}
        >
          {item.replace('_', ' ')}
        </button>
      ))}
    </div>
  );
}

export function TodoFilterBar({ filters, onChange, allLabels }: Props): React.ReactElement {
  const active = hasActiveFilters(filters);

  const clearAll = () => onChange({ types: [], priorities: [], labels: [], search: '' });

  return (
    <div className="px-3 py-2 bg-mf-panel-bg border-b border-mf-border space-y-1.5 shrink-0">
      {/* Search + clear */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 flex-1 bg-mf-app-bg border border-mf-border rounded-mf-input px-2 py-1">
          <Search size={12} className="text-mf-text-secondary shrink-0" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            placeholder="Filter by title..."
            className="flex-1 bg-transparent text-mf-small text-mf-text-primary placeholder:text-mf-text-secondary focus:outline-none"
          />
          {filters.search && (
            <button onClick={() => onChange({ ...filters, search: '' })} className="text-mf-text-secondary">
              <X size={10} />
            </button>
          )}
        </div>
        {active && (
          <button onClick={clearAll} className="text-mf-status text-mf-accent hover:underline whitespace-nowrap">
            Clear filters
          </button>
        )}
      </div>

      {/* Type chips */}
      <div className="flex items-center gap-1.5">
        <span className="text-mf-status text-mf-text-secondary shrink-0">Type:</span>
        <ChipGroup
          items={TYPES}
          selected={filters.types}
          onToggle={(t) => onChange({ ...filters, types: toggleItem(filters.types, t) })}
        />
      </div>

      {/* Priority chips */}
      <div className="flex items-center gap-1.5">
        <span className="text-mf-status text-mf-text-secondary shrink-0">Priority:</span>
        <ChipGroup
          items={PRIORITIES}
          selected={filters.priorities}
          onToggle={(p) => onChange({ ...filters, priorities: toggleItem(filters.priorities, p) })}
        />
      </div>

      {/* Label chips (only if labels exist) */}
      {allLabels.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-mf-status text-mf-text-secondary shrink-0">Labels:</span>
          <ChipGroup
            items={allLabels}
            selected={filters.labels}
            onToggle={(l) => onChange({ ...filters, labels: toggleItem(filters.labels, l) })}
          />
        </div>
      )}
    </div>
  );
}
