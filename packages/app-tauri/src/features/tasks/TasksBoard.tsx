/**
 * TasksBoard — the Tasks full-view modal shell.
 *
 * Header: checklist glyph + "Tasks" + active/done chip + List/Board switch + New.
 * Body: TasksFilterBar + TaskListView or TaskBoardView.
 *
 * SINGLE loader owner: the Inspector drawer (TasksDrawer/TasksDrawerList) owns the
 * project-scoped useTodosStore.load() effect. TasksBoard does NOT install its own
 * load effect; it reuses the already-cached store state.
 *
 * data-testid="tasks-board-modal".
 */
import React, { useState } from 'react';
import { LayoutList, LayoutGrid, Plus, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTodosStore } from './use-todos-store';
import { matchesFilters, sortTodos, extractAllLabels } from './todos-filters';
import type { TodoFilters } from './todos-filters';
import { TasksFilterBar } from './TasksFilterBar';
import { TaskListView } from './TaskListView';
import { TaskBoardView } from './TaskBoardView';
import { TaskEditModal } from './TaskEditModal';
import type { Todo } from '@/lib/api/todos';

interface Props {
  port: number;
  projectId: string;
  onStartSession: (todo: Todo) => void;
}

export function TasksBoard({ port, projectId, onStartSession }: Props): React.ReactElement {
  const { todos, loading, filters, sort, view, move, remove, setFilters, setSort, setView } = useTodosStore();
  const [editTodo, setEditTodo] = useState<Todo | null | undefined>(undefined);

  const allLabels = extractAllLabels(todos);
  const filtered = sortTodos(
    todos.filter((t) => matchesFilters(t, filters)),
    sort,
  );
  const filtersActive =
    (filters as TodoFilters).types.length > 0 ||
    (filters as TodoFilters).priorities.length > 0 ||
    (filters as TodoFilters).labels.length > 0 ||
    (filters as TodoFilters).search.trim().length > 0;

  const activeCount = todos.filter((t) => t.status !== 'done').length;
  const doneCount = todos.filter((t) => t.status === 'done').length;

  function handleEdit(todo: Todo) {
    setEditTodo(todo);
  }

  function handleNew() {
    setEditTodo(null);
  }

  function handleDelete(id: string) {
    void remove(port, id, projectId);
  }

  function handleMove(port: number, id: string, status: Todo['status'], projectId: string) {
    return move(port, id, status, projectId);
  }

  function handleStart(todo: Todo) {
    onStartSession(todo);
  }

  return (
    <div data-testid="tasks-board-modal" className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <ListChecks size={15} className="shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-body font-semibold text-foreground">Tasks</span>
        <span className="text-caption text-muted-foreground bg-muted rounded-full px-2 py-0.5">
          {activeCount} active · {doneCount} done
        </span>

        {/* List / Board segmented switch */}
        <div className="ml-auto flex items-center gap-0.5 rounded-[6px] bg-muted p-0.5">
          <button
            data-testid="tasks-view-list"
            type="button"
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-caption transition-colors',
              view === 'list'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <LayoutList size={12} />
            List
          </button>
          <button
            data-testid="tasks-view-board"
            type="button"
            onClick={() => setView('board')}
            aria-pressed={view === 'board'}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-caption transition-colors',
              view === 'board'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <LayoutGrid size={12} />
            Board
          </button>
        </div>

        {/* New task */}
        <button
          data-testid="tasks-board-new"
          type="button"
          onClick={handleNew}
          className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-primary text-primary-foreground text-caption hover:opacity-90 transition-opacity"
        >
          <Plus size={12} />
          New
        </button>
      </div>

      {/* Filter bar */}
      <TasksFilterBar
        filters={filters}
        onChange={setFilters}
        allLabels={allLabels}
        sort={sort}
        onSortChange={setSort}
        todos={todos}
      />

      {/* Body */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-caption text-muted-foreground">Loading tasks…</div>
      ) : view === 'list' ? (
        <TaskListView
          port={port}
          projectId={projectId}
          todos={filtered}
          filters={filters as TodoFilters}
          onEdit={handleEdit}
          onStartSession={handleStart}
        />
      ) : (
        <TaskBoardView
          port={port}
          projectId={projectId}
          todos={filtered}
          filtersActive={filtersActive}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onStartSession={handleStart}
          onMove={handleMove}
        />
      )}

      {/* Edit / Create modal */}
      {editTodo !== undefined && (
        <TaskEditModal
          port={port}
          projectId={projectId}
          todo={editTodo}
          allTodos={todos}
          allLabels={allLabels}
          onClose={() => setEditTodo(undefined)}
          onStartSession={(id) => {
            const todo = todos.find((t) => t.id === id);
            if (todo) onStartSession(todo);
            setEditTodo(undefined);
          }}
        />
      )}
    </div>
  );
}
