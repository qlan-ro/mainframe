/**
 * DependencyPicker — searchable picker over allTodos (excludes self + already
 * selected). Selected deps shown as removable number-pills.
 *
 * Port of packages/app-electron/…/todos/DependencyPicker.tsx.
 * Rebuilt on warm-chrome tokens; click-outside and Escape handled locally.
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { X, Plus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Todo } from '@/lib/api/todos';

const MAX_VISIBLE = 5;

interface Props {
  currentNumber?: number;
  allTodos: Todo[];
  value: number[];
  onChange: (v: number[]) => void;
}

export function DependencyPicker({ currentNumber, allTodos, value, onChange }: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const available = useMemo(
    () => allTodos.filter((t) => t.number !== currentNumber && !value.includes(t.number)),
    [allTodos, currentNumber, value],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return available.slice(0, MAX_VISIBLE);
    const q = search.toLowerCase();
    return available.filter((t) => t.title.toLowerCase().includes(q) || `#${t.number}`.includes(q));
  }, [available, search]);

  const selected = allTodos.filter((t) => value.includes(t.number));

  const addDep = (num: number) => {
    onChange([...value, num]);
    setSearch('');
  };

  const removeDep = (num: number) => onChange(value.filter((n) => n !== num));

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div className="flex flex-col gap-1">
      <label className="text-caption text-muted-foreground">Depends on</label>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((t) => (
            <span
              key={t.number}
              data-testid={`tasks-dep-pill-${t.number}`}
              className="flex items-center gap-1 bg-muted px-1.5 py-0.5 rounded text-caption text-muted-foreground"
            >
              #{t.number} {t.title.length > 24 ? t.title.slice(0, 24) + '…' : t.title}
              <button
                type="button"
                data-testid={`tasks-dep-remove-${t.number}`}
                onClick={() => removeDep(t.number)}
                className="hover:text-foreground transition-colors"
                aria-label={`Remove dependency on #${t.number}`}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <div ref={containerRef} className="relative">
          <button
            type="button"
            data-testid="tasks-dep-input"
            className={cn(
              'flex items-center gap-1 text-caption text-muted-foreground cursor-pointer',
              'w-full px-2 py-1 rounded-md border border-border bg-background hover:bg-muted transition-colors',
            )}
            onClick={() => setOpen(!open)}
          >
            <Plus size={12} />
            Add dependency…
          </button>
          {open && (
            <div className="absolute left-0 top-full mt-1 z-50 w-full min-w-[240px] bg-popover border border-border rounded-md shadow-lg overflow-hidden">
              <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border">
                <Search size={12} className="text-muted-foreground shrink-0" />
                <input
                  ref={searchRef}
                  type="text"
                  className="bg-transparent text-caption text-foreground placeholder:text-muted-foreground focus:outline-none w-full"
                  placeholder="Search tasks…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <ul className="max-h-[180px] overflow-y-auto py-0.5">
                {filtered.length === 0 && (
                  <li className="px-2 py-1.5 text-caption text-muted-foreground">No matching tasks</li>
                )}
                {filtered.map((t) => (
                  <li key={t.number}>
                    <button
                      type="button"
                      data-testid={`tasks-dep-opt-${t.number}`}
                      className="w-full text-left px-2 py-1.5 text-caption text-foreground hover:bg-muted transition-colors"
                      onClick={() => addDep(t.number)}
                    >
                      <span className="text-muted-foreground">#{t.number}</span>{' '}
                      {t.title.length > 40 ? t.title.slice(0, 40) + '…' : t.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {available.length === 0 && value.length === 0 && (
        <span className="text-caption text-muted-foreground opacity-60">No other tasks available</span>
      )}
    </div>
  );
}
