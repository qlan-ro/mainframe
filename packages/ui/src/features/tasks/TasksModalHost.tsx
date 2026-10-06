/**
 * TasksModalHost — single app-root host for the ONE task edit modal and the
 * QuickTaskDialog. The Kanban/List board moved to the body (`TasksSurface`,
 * D1/D7) — it is no longer a dialog this host owns, and it reads the shared
 * session scope directly rather than carrying a per-open scope of its own.
 *
 * `TaskEditHost` resolves the shared edit modal (behind the store's `edit`
 * target) that the board, the panel card and the sidebar list all open.
 * `QuickTaskDialog` keeps its own per-open scope (`useModalProjectScope`),
 * seeded from the sidebar filter on the rising edge of ITS open — unrelated
 * to D7's shared scope, since a quick-added task's project is a one-off
 * choice, not a navigation.
 *
 * Registers ⌘⇧T → openQuick(). Mounted once in AppShell's outlet block — so
 * unlike `useModalProjectScope`'s own internal instance (reloaded per hook,
 * per open), this component's top-level `useProjects()` never remounts and
 * never refetches on its own. Without an explicit reload here, a project
 * added after boot stays permanently absent from `projects` below: `known()`
 * keeps rejecting it and the quick-add pick list never lists it, however
 * many times it reopens. Reloading on the rising edge of its open keeps it
 * current.
 */
import React, { useEffect } from 'react';
import { soleProjectId, useSessionFilters } from '@/store/session-filters';
import { useShortcutAction } from '@/features/shortcuts/action-store';
import { useProjects } from '@/features/sessions/use-projects';
import { useModalProjectScope } from '@/features/project-scope/use-modal-project-scope';
import { useTasksModal } from './use-tasks-modal';
import { selectProjectTodos, useTodosStore } from './use-todos-store';
import { useTasksProjects } from './use-tasks-projects';
import { QuickTaskDialog } from './QuickTaskDialog';
import { TaskEditModal } from './sidebar/TaskEditModal';
import { extractAllLabels } from './todos-filters';
import { useStartTodoSession } from './use-start-todo-session';
import type { TaskEditTarget } from './use-tasks-modal';

/**
 * The shared edit/create modal, resolved against its project's todos bucket.
 * `projects` is the scope's full candidate list — only used (and only
 * rendered) when CREATING with more than one project in scope, for the
 * create form's project select.
 */
function TaskEditHost({ port, edit, onClose }: { port: number; edit: TaskEditTarget; onClose: () => void }) {
  const { todos } = useTodosStore(selectProjectTodos(edit.projectId));
  const { projects: allProjects } = useProjects();
  const scopeProjectIds = useTasksProjects();
  const startSession = useStartTodoSession(port);
  const todo = edit.todoId == null ? null : (todos.find((t) => t.id === edit.todoId) ?? null);
  // A todo deleted out from under an open edit has nothing left to edit.
  if (edit.todoId != null && todo == null) return null;
  const scopedProjects = allProjects.filter((p) => scopeProjectIds.includes(p.id));
  return (
    <TaskEditModal
      port={port}
      projectId={edit.projectId}
      todo={todo}
      allTodos={todos}
      allLabels={extractAllLabels(todos)}
      projects={scopedProjects}
      onClose={onClose}
      onStartSession={(id) => {
        const target = todos.find((t) => t.id === id);
        if (target) void startSession(target.id, target.project_id, target.status);
      }}
    />
  );
}

interface Props {
  port: number;
}

export function TasksModalHost({ port }: Props): React.ReactElement {
  const { quickOpen, openQuick, closeQuick, edit, closeEdit } = useTasksModal();
  const { projects, reloadProjects } = useProjects();
  const filterProjectId = useSessionFilters((s) => soleProjectId(s.filterProjectIds));
  const quick = useModalProjectScope(quickOpen);

  // Rising edge of the quick dialog — this instance's own list, not the scope
  // hook's internal one, is what `known()`/the pick list below read.
  const reloadProjectsRef = React.useRef(reloadProjects);
  reloadProjectsRef.current = reloadProjects;
  const wasOpenRef = React.useRef(false);
  useEffect(() => {
    if (quickOpen && !wasOpenRef.current) void reloadProjectsRef.current();
    wasOpenRef.current = quickOpen;
  }, [quickOpen]);

  // A project deleted while the dialog is open leaves its scope pointing at
  // nothing; falling back to the pick list keeps the surface honest without an
  // effect racing the render.
  const quickProjectId =
    quick.projectId !== null && projects.some((project) => project.id === quick.projectId) ? quick.projectId : null;

  useShortcutAction('app.quick-task', openQuick);

  return (
    <>
      {edit != null && <TaskEditHost port={port} edit={edit} onClose={closeEdit} />}

      {/* Quick-add dialog */}
      <QuickTaskDialog
        port={port}
        projectId={quickProjectId}
        projects={projects}
        filterProjectId={filterProjectId}
        onSelectProject={quick.setProjectId}
        open={quickOpen}
        onClose={closeQuick}
      />
    </>
  );
}
