/**
 * TasksSurface — the body's Tasks view (the `SidebarInset` content while
 * `sidebarView` is 'tasks', D1). The Kanban/List board for the session
 * scope's sole project, or a pick list when the scope names none or several
 * (D7) — picking narrows the shared scope, so Chats and Automations follow.
 *
 * "Start" on a board row starts the session and does nothing else: the D3
 * seam (the active-thread-change hook mounted in AppShell) brings Chats back
 * on its own once the new session activates.
 */
import { useProjects } from '@/features/sessions/use-projects';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { ProjectPickList } from '@/features/project-scope/ProjectPickList';
import { projectsInScopeOrAll, useSessionFilters } from '@/store/session-filters';
import { useStartTodoSession } from './use-start-todo-session';
import { useTasksProject } from './use-tasks-project';
import { TasksBoard } from './TasksBoard';

export function TasksSurface() {
  const port = useDaemonPort();
  const projectId = useTasksProject();
  const { projects } = useProjects();
  const filterProjectIds = useSessionFilters((s) => s.filterProjectIds);
  const soloFilterProject = useSessionFilters((s) => s.soloFilterProject);
  const startSession = useStartTodoSession(port, projectId ?? undefined);

  if (projectId == null) {
    return (
      <div
        data-testid="tasks-surface-pick"
        className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-8"
      >
        <p className="text-sm text-muted-foreground">Pick the project whose board you want to open.</p>
        <div className="w-full max-w-sm">
          <ProjectPickList
            surface="tasks-board"
            projects={projectsInScopeOrAll(projects, filterProjectIds)}
            filterProjectId={null}
            onSelect={soloFilterProject}
          />
        </div>
      </div>
    );
  }

  return (
    <TasksBoard port={port} projectId={projectId} onStartSession={(todo) => void startSession(todo.id, todo.status)} />
  );
}
