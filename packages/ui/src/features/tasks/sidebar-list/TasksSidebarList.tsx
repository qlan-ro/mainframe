/**
 * TasksSidebarList — the sidebar's Tasks view (the nav rail's second list).
 * Header: "Tasks", the shared scope strip (D7), and the quick-add row. The
 * projects are the session scope's project SET (multi-project, same scope
 * semantics as Chats/Automations; `useTasksProjects`, shared with the body's
 * `TasksSurface`) — an empty or multi-project scope merges every project's
 * todos, there is no pick-list fallback any more. Groups: In progress /
 * Open / Done (Done collapsed). A row opens the shared edit modal, Start
 * opens a session, both scoped to the ROW's own project.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import type { Project } from '@qlan-ro/mainframe-types';
import { SidebarHeader } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import type { Todo } from '@/lib/api/todos';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useProjects } from '@/features/sessions/use-projects';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { SidebarScopeStrip } from '@/features/sessions/SidebarScopeStrip';
import { SidebarScrollRegion } from '@/features/shared/SidebarScrollRegion';
import { useQuickAddTodo } from '../use-quick-add-todo';
import { useStartTodoSession } from '../use-start-todo-session';
import { useTasksModal } from '../use-tasks-modal';
import { useMergedTodos, useTodosStore } from '../use-todos-store';
import { newestFirst } from '../todos-filters';
import { useTasksProjects } from '../use-tasks-projects';
import { resolveDefaultTaskProject } from '../resolve-default-project';
import { TaskProjectPicker } from '../TaskProjectPicker';
import { TaskSidebarRow, nextTodoStatus } from './TaskSidebarRow';

const GROUPS: { status: Todo['status']; label: string; collapsedByDefault: boolean }[] = [
  { status: 'in_progress', label: 'In progress', collapsedByDefault: false },
  { status: 'open', label: 'Open', collapsedByDefault: false },
  { status: 'done', label: 'Done', collapsedByDefault: true },
];

function QuickAddRow({ port, projectIds, projects }: { port: number; projectIds: string[]; projects: Project[] }) {
  const activeProjectId = useActiveIdentity().projectId ?? null;
  const multi = projectIds.length > 1;
  const [targetProjectId, setTargetProjectId] = useState(
    () => resolveDefaultTaskProject(projectIds, activeProjectId) ?? projectIds[0] ?? '',
  );

  // Keep the target valid as the scope's project set changes — falling back
  // to the same default rule a quick-add that never touched the picker would
  // have started from.
  useEffect(() => {
    if (!projectIds.includes(targetProjectId)) {
      setTargetProjectId(resolveDefaultTaskProject(projectIds, activeProjectId) ?? projectIds[0] ?? '');
    }
  }, [projectIds, activeProjectId, targetProjectId]);

  const quick = useQuickAddTodo(port, targetProjectId);
  const scopedProjects = useMemo(() => projects.filter((p) => projectIds.includes(p.id)), [projects, projectIds]);

  return (
    <div className="flex h-8 items-center gap-2 rounded-md px-2 transition-colors focus-within:bg-sidebar-accent">
      {multi ? (
        <TaskProjectPicker
          surface="tasks-sidebar-new"
          projects={scopedProjects}
          value={targetProjectId}
          onChange={setTargetProjectId}
          compact
        />
      ) : (
        <Plus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <input
        ref={quick.inputRef}
        data-testid="tasks-sidebar-new"
        data-noring
        value={quick.draft}
        disabled={quick.adding}
        onChange={(event) => quick.setDraft(event.target.value)}
        onPaste={quick.onPaste}
        onKeyDown={quick.onKeyDown}
        placeholder="New task"
        className="min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
      />
    </div>
  );
}

function TaskGroup({
  label,
  todos,
  open,
  onToggle,
  children,
}: {
  label: string;
  todos: Todo[];
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section data-testid={`tasks-sidebar-group-${label}`}>
      <button
        type="button"
        data-testid={`tasks-sidebar-group-toggle-${label}`}
        aria-expanded={open}
        onClick={onToggle}
        className="flex h-7 w-full items-center gap-1 px-2 text-xs font-semibold text-muted-foreground"
      >
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <span className="tabular-nums">{todos.length}</span>
      </button>
      {open && <div className="flex flex-col gap-0.5">{children}</div>}
    </section>
  );
}

function TaskList({ port, projectIds, projects }: { port: number; projectIds: string[]; projects: Project[] }) {
  const load = useTodosStore((s) => s.load);
  const move = useTodosStore((s) => s.move);
  const { todos, loading } = useMergedTodos(projectIds);
  const openEdit = useTasksModal((s) => s.openEdit);
  const startSession = useStartTodoSession(port);
  const multi = projectIds.length > 1;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.map((g) => [g.status, g.collapsedByDefault])),
  );

  useEffect(() => {
    for (const id of projectIds) void load(port, id);
  }, [port, projectIds, load]);

  const byStatus = useMemo(() => {
    const map: Record<Todo['status'], Todo[]> = { open: [], in_progress: [], done: [] };
    for (const todo of newestFirst(todos)) map[todo.status].push(todo);
    return map;
  }, [todos]);

  if (loading && todos.length === 0) {
    return (
      <div data-testid="tasks-sidebar-loading" className="px-2 py-6 text-center text-xs text-muted-foreground">
        Loading tasks…
      </div>
    );
  }
  if (todos.length === 0) {
    return (
      <div data-testid="tasks-sidebar-empty" className="px-2 py-6 text-center text-xs text-muted-foreground">
        No tasks yet.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {GROUPS.map((group) =>
        byStatus[group.status].length === 0 ? null : (
          <TaskGroup
            key={group.status}
            label={group.label}
            todos={byStatus[group.status]}
            open={!collapsed[group.status]}
            onToggle={() => setCollapsed((prev) => ({ ...prev, [group.status]: !prev[group.status] }))}
          >
            {byStatus[group.status].map((todo) => (
              <TaskSidebarRow
                key={todo.id}
                todo={todo}
                project={multi ? projects.find((p) => p.id === todo.project_id) : undefined}
                onCycle={(t) => void move(port, t.id, nextTodoStatus(t.status), t.project_id)}
                onEdit={(t) => openEdit({ projectId: t.project_id, todoId: t.id })}
                onStart={(t) => void startSession(t.id, t.project_id, t.status)}
              />
            ))}
          </TaskGroup>
        ),
      )}
    </div>
  );
}

export function TasksSidebarList() {
  const port = useDaemonPort();
  const { projects } = useProjects();
  const projectIds = useTasksProjects();

  return (
    <>
      <SidebarHeader className="gap-3">
        <div className="flex h-9 items-center pl-1">
          <span className="text-base font-semibold">Tasks</span>
        </div>
        <SidebarScopeStrip />
        {projectIds.length > 0 && <QuickAddRow port={port} projectIds={projectIds} projects={projects} />}
      </SidebarHeader>
      <SidebarScrollRegion>
        <div className="px-2">
          <TaskList port={port} projectIds={projectIds} projects={projects} />
        </div>
      </SidebarScrollRegion>
    </>
  );
}
