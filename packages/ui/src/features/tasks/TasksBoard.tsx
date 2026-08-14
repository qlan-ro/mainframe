/**
 * TasksBoard — the Tasks full-view modal shell.
 *
 * Header: checklist glyph + "Tasks" + active/done chip + List/Board switch + New.
 * Body: TasksFilterBar + TaskListView or TaskBoardView.
 *
 * Loads the todos store itself: the always-mounted sidebar section that used to
 * own the load effect is gone (Tasks moved to the session-panel rail), and the
 * rail's TasksCard mounts only while its panel is open. The store's sequence
 * guard makes the two loaders safe, not racy.
 *
 * data-testid="tasks-board-modal".
 */
import React, { useState } from 'react';
import type { Project } from '@qlan-ro/mainframe-types';
import { LayoutList, LayoutGrid, Plus, ListChecks, X } from 'lucide-react';
import { ModalProjectPicker } from '@/features/project-scope/ModalProjectPicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTodosStore, selectProjectTodos } from './use-todos-store';
import { matchesFilters, sortTodos, extractAllLabels } from './todos-filters';
import type { TodoFilters } from './todos-filters';
import { TasksFilterBar } from './TasksFilterBar';
import { TaskListView } from './TaskListView';
import { TaskBoardView } from './TaskBoardView';
import { TaskEditModal } from './TaskEditModal';
import { GitHubSyncControl } from './github/GitHubSyncControl';
import { SyncRunBanner } from './github/SyncRunBanner';
import { LinkRepoDialog } from './github/LinkRepoDialog';
import { ImportIssuesDialog } from './github/ImportIssuesDialog';
import { PublishTaskDialog } from './github/PublishTaskDialog';
import { SyncReportDialog } from './github/SyncReportDialog';
import { UpdateTokenDialog } from './github/UpdateTokenDialog';
import { useGitHubSyncStore } from './github/use-github-sync-store';
import type { Todo } from '@/lib/api/todos';

interface Props {
  port: number;
  projectId: string;
  projects: Project[];
  /** Re-scopes this open of the modal; the sidebar filter is never written. */
  onProjectChange: (projectId: string) => void;
  onStartSession: (todo: Todo) => void;
  onClose: () => void;
}

export function TasksBoard({
  port,
  projectId,
  projects,
  onProjectChange,
  onStartSession,
  onClose,
}: Props): React.ReactElement {
  const { todos, loading } = useTodosStore(selectProjectTodos(projectId));
  const { load, filters, sort, view, move, remove, setFilters, setSort, setView } = useTodosStore();
  const { init: initSync, load: loadSync, dialog: syncDialog } = useGitHubSyncStore();
  const [editTodo, setEditTodo] = useState<Todo | null | undefined>(undefined);

  React.useEffect(() => {
    void load(port, projectId);
    initSync(port, projectId);
    void loadSync();
  }, [port, projectId, load, initSync, loadSync]);

  // An edit modal must not survive a re-scope holding the previous project's
  // todo (the same reason TasksCard resets on the active project).
  React.useEffect(() => setEditTodo(undefined), [projectId]);

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
    // flex-1, not h-full: DialogContent only sets min/max-height (no explicit
    // height), so percentage sizing here doesn't resolve reliably — flex-grow
    // makes this fill available space regardless, threading through to
    // TaskBoardView/TaskListView (already flex-1) and the board's columns.
    <div data-testid="tasks-board-modal" className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* Header band. Close sits at the far RIGHT — every dialog closes on the
          right (stock shadcn position); the old left-side X predates the port. */}
      <div className="flex h-[52px] shrink-0 items-center gap-4 border-b px-4">
        <ListChecks size={15} className="shrink-0 text-primary" aria-hidden />
        <span className="text-base font-semibold text-foreground">Tasks</span>
        <ModalProjectPicker
          surface="tasks-board"
          projectId={projectId}
          projects={projects}
          onSelect={(id) => {
            if (id !== null) onProjectChange(id);
          }}
        />
        <Badge variant="secondary" className="font-mono text-xs font-normal text-muted-foreground">
          {activeCount} active · {doneCount} done
        </Badge>

        {/* List / Board view switch */}
        <Tabs value={view} onValueChange={(v) => setView(v as 'list' | 'board')} className="ml-auto">
          <TabsList className="h-8">
            <TabsTrigger value="list" data-testid="tasks-view-list">
              <LayoutList />
              List
            </TabsTrigger>
            <TabsTrigger value="board" data-testid="tasks-view-board">
              <LayoutGrid />
              Board
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <GitHubSyncControl />

        {/* New task */}
        <Button size="sm" data-testid="tasks-board-new" onClick={handleNew}>
          <Plus />
          New task
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="tasks-board-close"
          onClick={onClose}
          aria-label="Close (Esc)"
        >
          <X />
        </Button>
      </div>

      <SyncRunBanner />

      {/* Filter bar */}
      <TasksFilterBar
        filters={filters}
        onChange={setFilters}
        allLabels={allLabels}
        sort={sort}
        onSortChange={setSort}
        todos={todos}
      />

      {/* Body — only blank to the loading state on the first load; a refetch
          (e.g. reopening the modal) keeps the previous list rendered. */}
      {loading && todos.length === 0 ? (
        <div
          data-testid="tasks-board-loading"
          className="flex-1 flex items-center justify-center text-xs text-muted-foreground"
        >
          Loading tasks…
        </div>
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

      {/* GitHub sync dialogs — one mount each, driven by the sync store's
          `dialog`. LinkRepoDialog is the exception: it refetches the project's
          remotes on mount, so it is gated here rather than self-gated. */}
      {syncDialog?.kind === 'link' && <LinkRepoDialog />}
      <ImportIssuesDialog />
      <PublishTaskDialog />
      <SyncReportDialog />
      <UpdateTokenDialog />
    </div>
  );
}
