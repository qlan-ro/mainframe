/**
 * TaskListView — status-grouped list view for the Tasks surface.
 *
 * Groups: In Progress / Open / Done (Done collapsed by default).
 * Keyboard nav: ↑/↓ (j/k) select row; ↵ start session; E edit;
 * Space cycle status; →/← expand/collapse group.
 *
 * Receives todos + handlers from TasksBoard; no data loading here.
 */
import React, { useState, useCallback, useRef } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Todo, TodoStatus } from '@/lib/api/todos';
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
  onEdit: (todo: Todo) => void;
  onStartSession: (todo: Todo) => void;
}

type GroupKey = TodoStatus;

export function TaskListView({ todos, onEdit, onStartSession }: Props): React.ReactElement {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<GroupKey>>(new Set(['done']));
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
      }
    },
    [flatVisible, selectedNumber, onStartSession, onEdit],
  );

  const grouped = GROUP_ORDER.map((status) => ({
    status,
    items: todos.filter((t) => t.status === status),
  }));

  return (
    <div
      ref={containerRef}
      className="flex flex-col min-h-0 flex-1 overflow-y-auto mf-thin-scrollbar focus:outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {grouped.map(({ status, items }) => (
        <div key={status}>
          {/* Group header */}
          <button
            type="button"
            className="flex items-center gap-1.5 w-full px-3 py-1.5 bg-muted/40 border-b border-border hover:bg-accent transition-colors text-xs font-semibold text-muted-foreground"
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
                expanded={expanded.has(todo.number)}
                onToggle={toggleRow}
                onEdit={onEdit}
                onStartSession={onStartSession}
              />
            ))}
        </div>
      ))}

      {todos.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground py-12">
          No tasks match the current filters.
        </div>
      )}

      {/* Footer hint */}
      <div className="shrink-0 px-3 py-2 border-t border-border bg-card text-xs text-muted-foreground">
        <span>↑/↓ select · ↵ start session · E edit</span>
      </div>
    </div>
  );
}
