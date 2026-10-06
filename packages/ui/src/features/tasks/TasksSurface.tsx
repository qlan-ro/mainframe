/**
 * TasksSurface — the body's Tasks view (the `SidebarInset` content while
 * `sidebarView` is 'tasks', D1). The Kanban/List board for the session
 * scope's project SET (multi-project, same scope semantics as Chats and
 * Automations) — an empty or multi-project scope merges every project's
 * todos rather than asking the user to pick one first (there is no pick-list
 * fallback any more).
 *
 * "Start" on a board row starts the session and does nothing else: the D3
 * seam (the active-thread-change hook mounted in AppShell) brings Chats back
 * on its own once the new session activates.
 */
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useTasksProjects } from './use-tasks-projects';
import { useStartTodoSession } from './use-start-todo-session';
import { TasksBoard } from './TasksBoard';

export function TasksSurface() {
  const port = useDaemonPort();
  const projectIds = useTasksProjects();
  const startSession = useStartTodoSession(port);

  return (
    <TasksBoard
      port={port}
      projectIds={projectIds}
      onStartSession={(todo) => void startSession(todo.id, todo.project_id, todo.status)}
    />
  );
}
