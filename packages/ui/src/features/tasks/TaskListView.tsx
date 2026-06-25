/**
 * TaskListView — status-grouped list view for the Tasks surface.
 *
 * Groups: In Progress / Open / Done (Done collapsed by default).
 * Keyboard nav: ↑/↓ (j/k) select row; ↵ start session; E edit;
 * Space cycle status; →/← expand/collapse row.
 *
 * Receives todos + handlers from TasksBoard; no data loading here.
 */
import React, { useState, useCallback, useRef } from 'react';
import { ChevronDown, ChevronRight, ListChecks } from 'lucide-react';
import type { Todo, TodoStatus } from '@/lib/api/todos';
import type { TodoFilters } from './todos-filters';
import { useTodosStore } from './use-todos-store';
import { TaskListRow } from './TaskListRow';

const GROUP_ORDER: TodoStatus[] = ['in_progress', 'open', 'done'];
const GROUP_LABEL: Record<TodoStatus, string> = {
  in_progress: 'In Progress',
  open: 'Open',
  done: 'Done',
};

interface Props {
  port: number;
  projectId: string;
  todos: Todo[];
  filters?: TodoFilters;
  onEdit: (todo: Todo) => void;
  onStartSession: (todo: Todo) => void;
}

type GroupKey = TodoStatus;

export function TaskListView({ port, projectId, todos, filters, onEdit, onStartSession }: Props): React.ReactElement {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<GroupKey>>(new Set(['done']));
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { move, remove } = useTodosStore();

  const toggleRow = useCallback((number: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((group: GroupKey) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  const flatVisible = GROUP_ORDER.flatMap((status) => {
    if (collapsedGroups.has(status)) return [];
    return todos.filter((t) => t.status === status);
  });

  const handleCycle = useCallback(
    (id: string) => {
      const todo = todos.find((t) => t.id === id);
      if (!todo) return;
      const nextStatus: TodoStatus =
        todo.status === 'open' ? 'in_progress' : todo.status === 'in_progress' ? 'done' : 'open';
      void move(port, id, nextStatus, projectId);
    },
    [todos, move, port, projectId],
  );

  const handleDelete = useCallback(
    (id: string) => {
      void remove(port, id, projectId);
    },
    [remove, port, projectId],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!flatVisible.length) return;
      const idx = selectedNumber != null ? flatVisible.findIndex((t) => t.number === selectedNumber) : -1;

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        const next = flatVisible[Math.min(idx + 1, flatVisible.length - 1)];
        if (next) setSelectedNumber(next.number);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        const next = flatVisible[Math.max(idx - 1, 0)];
        if (next) setSelectedNumber(next.number);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const todo = flatVisible[idx];
        if (todo) onStartSession(todo);
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        const todo = flatVisible[idx];
        if (todo) onEdit(todo);
      } else if (e.key === ' ') {
        e.preventDefault();
        const todo = flatVisible[idx];
        if (todo) handleCycle(todo.id);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (selectedNumber != null) {
          setExpanded((prev) => new Set(prev).add(selectedNumber));
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (selectedNumber != null) {
          setExpanded((prev) => {
            const s = new Set(prev);
            s.delete(selectedNumber);
            return s;
          });
        }
      }
    },
    [flatVisible, selectedNumber, onStartSession, onEdit, handleCycle],
  );

  const grouped = GROUP_ORDER.map((status) => ({
    status,
    items: todos.filter((t) => t.status === status),
  }));

  const totalVisible = grouped.reduce((sum, g) => sum + g.items.length, 0);
  const filtersActive =
    filters != null &&
    (filters.types.length > 0 ||
      filters.priorities.length > 0 ||
      filters.labels.length > 0 ||
      filters.search.trim().length > 0);

  return (
    <div
      ref={containerRef}
      className="flex flex-col min-h-0 flex-1 overflow-y-auto mf-thin-scrollbar focus:outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {totalVisible === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-caption text-muted-foreground py-12">
          <ListChecks size={26} className="text-muted-foreground/40" aria-hidden />
          {filtersActive ? 'No tasks match these filters' : 'No tasks yet'}
        </div>
      ) : (
        grouped.map(({ status, items }) =>
          items.length === 0 ? null : (
            <div key={status}>
              {/* Group header */}
              <button
                type="button"
                data-testid={`tasks-list-group-${status}`}
                className="sticky top-0 z-10 flex w-full items-center gap-1.5 border-b border-border bg-mf-content2 px-3 py-1.5 text-caption font-bold uppercase tracking-wide text-muted-foreground"
                onClick={() => toggleGroup(status)}
              >
                {collapsedGroups.has(status) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                {GROUP_LABEL[status]}
                <span className="ml-1 font-normal text-muted-foreground/70">{items.length}</span>
              </button>

              {/* Rows */}
              {!collapsedGroups.has(status) &&
                items.map((todo) => (
                  <TaskListRow
                    key={todo.id}
                    todo={todo}
                    selected={selectedNumber === todo.number}
                    expanded={expanded.has(todo.number)}
                    onToggle={toggleRow}
                    onEdit={onEdit}
                    onStartSession={onStartSession}
                    onCycle={handleCycle}
                    onDelete={handleDelete}
                  />
                ))}
            </div>
          ),
        )
      )}

      {/* Footer hint */}
      <div className="flex shrink-0 items-center gap-6 border-t border-border bg-mf-content2 px-3 py-1.5">
        {(
          [
            ['↑↓', 'Navigate'],
            ['↵', 'Start session'],
            ['E', 'Edit'],
            ['Space', 'Toggle status'],
          ] as const
        ).map(([key, label]) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <kbd className="rounded-sm border-[0.5px] border-border bg-card px-1.5 py-0.5 font-mono text-caption leading-none text-muted-foreground">
              {key}
            </kbd>
            <span className="text-caption text-mf-text-3">{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
