/**
 * TasksBoard — the Tasks board shell, filling the body while `sidebarView` is
 * 'tasks' (D1). The projects are the shared session scope's project SET
 * (resolved by the caller — `TasksSurface`; empty scope = every project) —
 * multi-project, same scope semantics as Chats/Automations. There is no
 * picker of its own, so the board always agrees with the sidebar list and
 * Chats' scope strip.
 *
 * Header: checklist glyph + "Tasks" + active/done chip + List/Board switch +
 * GitHub control (sole project only) + New. Body: TasksFilterBar + TaskListView
 * or TaskBoardView, over the MERGED todos of every project in `projectIds`.
 *
 * Loads every project's bucket itself (concurrently — the sidebar Tasks list
 * loads its own scope too; the store's per-project sequence guard makes the
 * loaders safe, not racy). The task edit modal is NOT mounted here — it is the
 * one modal `TasksModalHost` owns, opened through `useTasksModal.openEdit`.
 *
 * `onClose` is optional: body mode (`TasksSurface`) passes none and the
 * close button doesn't render — there is nothing to close, Tasks is a rail
 * view now, not a dialog.
 *
 * data-testid="tasks-board".
 */
import React from 'react';
import { LayoutList, LayoutGrid, Plus, ListChecks, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useProjects } from '@/features/sessions/use-projects';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useMergedTodos, useTodosStore } from './use-todos-store';
import { matchesFilters, sortTodos, extractAllLabels } from './todos-filters';
import type { TodoFilters } from './todos-filters';
import { resolveDefaultTaskProject } from './resolve-default-project';
import { TasksFilterBar } from './TasksFilterBar';
import { TaskListView } from './TaskListView';
import { TaskBoardView } from './TaskBoardView';
import { useTasksModal } from './use-tasks-modal';
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
  projectIds: string[];
  onStartSession: (todo: Todo) => void;
  /** Renders the close button only when provided — body mode passes none. */
  onClose?: () => void;
}

export function TasksBoard({ port, projectIds, onStartSession, onClose }: Props): React.ReactElement {
  const { projects } = useProjects();
  const activeProjectId = useActiveIdentity().projectId ?? null;
  const multi = projectIds.length > 1;
  // GitHub sync is a single-project feature — it never had a "several repos"
  // shape, so the control and its init only run when the set resolves to one.
  const singleProjectId = projectIds.length === 1 ? projectIds[0]! : null;

  const { todos, loading } = useMergedTodos(projectIds);
  const { load, filters, sort, view, move, remove, setFilters, setSort, setView } = useTodosStore();
  const { init: initSync, load: loadSync } = useGitHubSyncStore();
  const openEdit = useTasksModal((s) => s.openEdit);

  React.useEffect(() => {
    // Fired without awaiting each other — every project's load starts
    // concurrently; the store's per-project sequence guard keeps a slow
    // response from landing in the wrong bucket.
    for (const id of projectIds) void load(port, id);
  }, [port, projectIds, load]);

  React.useEffect(() => {
    if (singleProjectId == null) return;
    initSync(port, singleProjectId);
    void loadSync();
  }, [port, singleProjectId, initSync, loadSync]);

  const allLabels = extractAllLabels(todos);
  // `todos` is already concatenated in scope-strip (projectIds) order, so the
  // stable sort below keeps that as the tie-break for equal sort keys.
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
    openEdit({ projectId: todo.project_id, todoId: todo.id });
  }

  function handleNew() {
    const target = resolveDefaultTaskProject(projectIds, activeProjectId);
    if (target == null) return;
    openEdit({ projectId: target, todoId: null });
  }

  function handleDelete(id: string) {
    const todo = todos.find((t) => t.id === id);
    if (!todo) return;
    void remove(port, id, todo.project_id);
  }

  function handleMove(port: number, id: string, status: Todo['status'], moveProjectId: string) {
    return move(port, id, status, moveProjectId);
  }

  function handleStart(todo: Todo) {
    onStartSession(todo);
  }

  return (
    // flex-1, not h-full: DialogContent only sets min/max-height (no explicit
    // height), so percentage sizing here doesn't resolve reliably — flex-grow
    // makes this fill available space regardless, threading through to
    // TaskBoardView/TaskListView (already flex-1) and the board's columns.
    <div data-testid="tasks-board" className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* Header band. Close sits at the far RIGHT — every dialog closes on the
          right (stock shadcn position); the old left-side X predates the port. */}
      <div className="flex h-[52px] shrink-0 items-center gap-4 border-b px-4">
        <ListChecks size={15} className="shrink-0 text-primary" aria-hidden />
        <span className="text-base font-semibold text-foreground">Tasks</span>
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

        {/* GitHub sync — a single-repo feature; hidden for an empty/multi scope. */}
        {singleProjectId != null && <GitHubSyncControl />}

        {/* New task */}
        <Button size="sm" data-testid="tasks-board-new" onClick={handleNew} disabled={projectIds.length === 0}>
          <Plus />
          New task
        </Button>

        {onClose != null && (
          <Button variant="ghost" size="icon-sm" data-testid="tasks-board-close" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        )}
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

      {/* Body — only blank to the loading state on the first load (no todos
          yet for ANY project in scope); a refetch (e.g. reopening the modal)
          keeps the previous list rendered. */}
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
          todos={filtered}
          filters={filters as TodoFilters}
          projects={projects}
          multi={multi}
          onEdit={handleEdit}
          onStartSession={handleStart}
        />
      ) : (
        <TaskBoardView
          port={port}
          todos={filtered}
          filtersActive={filtersActive}
          projects={projects}
          multi={multi}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onStartSession={handleStart}
          onMove={handleMove}
        />
      )}

      {/* GitHub sync dialogs — one mount each, driven by the sync store's
          `dialog`. LinkRepoDialog is the exception: it refetches the project's
          remotes on mount, so it is gated here rather than self-gated. */}
      <TasksBoardGitHubDialogs />
    </div>
  );
}

/** Split out purely to keep the component body's line count down. */
function TasksBoardGitHubDialogs(): React.ReactElement {
  const dialog = useGitHubSyncStore((s) => s.dialog);
  return (
    <>
      {dialog?.kind === 'link' && <LinkRepoDialog />}
      <ImportIssuesDialog />
      <PublishTaskDialog />
      <SyncReportDialog />
      <UpdateTokenDialog />
    </>
  );
}
