import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, ChevronDown, Check, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Todo, TodoType, TodoPriority } from '../../lib/api/todos-api';

export type TodoSortKey = 'number' | 'priority' | 'type';
export type TodoSortDir = 'asc' | 'desc';
export interface TodoSort {
  key: TodoSortKey;
  dir: TodoSortDir;
}

export interface TodoFilters {
  types: TodoType[];
  priorities: TodoPriority[];
  labels: string[];
  search: string;
}

const TYPES: TodoType[] = ['bug', 'feature', 'enhancement', 'documentation', 'question'];
const PRIORITIES: TodoPriority[] = ['critical', 'high', 'medium', 'low'];

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SORT_LABELS: Record<TodoSortKey, string> = { number: '#', priority: 'Priority', type: 'Type' };
const SORT_KEYS: TodoSortKey[] = ['number', 'priority', 'type'];

/** Sort todos by the given key and direction. */
export function sortTodos(todos: Todo[], sort: TodoSort): Todo[] {
  const sorted = [...todos];
  const dir = sort.dir === 'asc' ? 1 : -1;
  sorted.sort((a, b) => {
    switch (sort.key) {
      case 'number':
        return (a.number - b.number) * dir;
      case 'priority':
        return ((PRIORITY_RANK[a.priority] ?? 4) - (PRIORITY_RANK[b.priority] ?? 4)) * dir;
      case 'type':
        return a.type.localeCompare(b.type) * dir;
    }
  });
  return sorted;
}

const chipBase = 'px-1.5 py-0.5 rounded text-mf-status cursor-pointer select-none transition-colors';
const chipOff = 'bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary';
const chipOn = 'bg-mf-accent/20 text-mf-accent';

interface Props {
  filters: TodoFilters;
  onChange: (f: TodoFilters) => void;
  allLabels: string[];
  sort: TodoSort;
  onSortChange: (s: TodoSort) => void;
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

function LabelsPopover({
  allLabels,
  selected,
  onToggle,
}: {
  allLabels: string[];
  selected: string[];
  onToggle: (label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node) || panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen((v) => !v);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 rounded text-mf-status cursor-pointer select-none transition-colors',
          selected.length > 0
            ? 'bg-mf-accent/20 text-mf-accent'
            : 'bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary',
        )}
      >
        Labels{selected.length > 0 && ` (${selected.length})`}
        <ChevronDown size={10} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
            className="z-50 min-w-[140px] max-h-48 overflow-y-auto bg-mf-panel-bg border border-mf-border rounded-mf-input shadow-lg py-1"
          >
            {allLabels.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => onToggle(label)}
                className="w-full flex items-center gap-2 px-2.5 py-1 text-mf-small text-mf-text-primary hover:bg-mf-hover transition-colors text-left"
              >
                <span
                  className={cn(
                    'w-3 h-3 rounded-sm border flex items-center justify-center shrink-0',
                    selected.includes(label) ? 'bg-mf-accent border-mf-accent' : 'border-mf-border',
                  )}
                >
                  {selected.includes(label) && <Check size={8} className="text-white" />}
                </span>
                {label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

const divider = 'w-px h-4 bg-mf-border shrink-0';

function SortControl({ sort, onSortChange }: { sort: TodoSort; onSortChange: (s: TodoSort) => void }) {
  const cycle = (key: TodoSortKey) => {
    if (sort.key === key) {
      onSortChange({ key, dir: sort.dir === 'desc' ? 'asc' : 'desc' });
    } else {
      onSortChange({ key, dir: key === 'number' ? 'desc' : 'asc' });
    }
  };

  const DirIcon = sort.dir === 'desc' ? ArrowDown : ArrowUp;

  return (
    <div className="flex items-center gap-1 shrink-0">
      <ArrowUpDown size={11} className="text-mf-text-secondary shrink-0" />
      {SORT_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => cycle(key)}
          className={cn(chipBase, sort.key === key ? chipOn : chipOff, 'flex items-center gap-0.5')}
        >
          {SORT_LABELS[key]}
          {sort.key === key && <DirIcon size={9} />}
        </button>
      ))}
    </div>
  );
}

export function TodoFilterBar({ filters, onChange, allLabels, sort, onSortChange }: Props): React.ReactElement {
  const active = hasActiveFilters(filters);
  const clearAll = () => onChange({ types: [], priorities: [], labels: [], search: '' });

  return (
    <div className="px-3 py-1.5 bg-mf-panel-bg border-b border-mf-border shrink-0 overflow-visible">
      <div className="flex items-center gap-2 min-w-0">
        {/* Type chips */}
        <span className="text-mf-status text-mf-text-secondary shrink-0">Type:</span>
        <ChipGroup
          items={TYPES}
          selected={filters.types}
          onToggle={(t) => onChange({ ...filters, types: toggleItem(filters.types, t) })}
        />

        <div className={divider} />

        {/* Priority chips */}
        <span className="text-mf-status text-mf-text-secondary shrink-0">Priority:</span>
        <ChipGroup
          items={PRIORITIES}
          selected={filters.priorities}
          onToggle={(p) => onChange({ ...filters, priorities: toggleItem(filters.priorities, p) })}
        />

        {/* Labels popover (only if labels exist) */}
        {allLabels.length > 0 && (
          <>
            <div className={divider} />
            <LabelsPopover
              allLabels={allLabels}
              selected={filters.labels}
              onToggle={(l) => onChange({ ...filters, labels: toggleItem(filters.labels, l) })}
            />
          </>
        )}

        {/* Clear filters */}
        {active && (
          <>
            <div className={divider} />
            <button
              onClick={clearAll}
              className="text-mf-status text-mf-accent hover:underline whitespace-nowrap shrink-0"
            >
              Clear
            </button>
          </>
        )}

        {/* Sort + Search — right-aligned */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <SortControl sort={sort} onSortChange={onSortChange} />
          <div className="flex items-center gap-1 w-40 bg-mf-app-bg border border-mf-border rounded-mf-input px-2 py-0.5">
            <Search size={12} className="text-mf-text-secondary shrink-0" />
            <input
              type="text"
              value={filters.search}
              onChange={(e) => onChange({ ...filters, search: e.target.value })}
              placeholder="Filter by title..."
              className="flex-1 bg-transparent text-mf-small text-mf-text-primary placeholder:text-mf-text-secondary focus:outline-none min-w-0"
            />
            {filters.search && (
              <button onClick={() => onChange({ ...filters, search: '' })} className="text-mf-text-secondary">
                <X size={10} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
