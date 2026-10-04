/**
 * TasksSidebarList — the sidebar's Tasks view (the nav rail's second list).
 * Header: "Tasks", Open board, and the quick-add row. Scope: the session
 * scope's sole project; with none, a picker row chooses one for this run.
 * Groups: In progress / Open / Done (Done collapsed). The detail views stay
 * in the existing modals — a row opens the shared edit modal, Start opens a
 * session, Open board opens the full Kanban.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, LayoutGrid, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { SidebarHeader } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import type { Todo } from '@/lib/api/todos';
import { ModalProjectPicker } from '@/features/project-scope/ModalProjectPicker';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useProjects } from '@/features/sessions/use-projects';
import { soleProjectId, useSessionFilters } from '@/store/session-filters';
import { SidebarScrollRegion } from '@/features/shared/SidebarScrollRegion';
import { useQuickAddTodo } from '../use-quick-add-todo';
import { useStartTodoSession } from '../use-start-todo-session';
import { useTasksModal } from '../use-tasks-modal';
import { selectProjectTodos, useTodosStore } from '../use-todos-store';
import { TaskSidebarRow, nextTodoStatus } from './TaskSidebarRow';
import { useTasksSidebarScope } from './use-tasks-sidebar-scope';

const GROUPS: { status: Todo['status']; label: string; collapsedByDefault: boolean }[] = [
  { status: 'in_progress', label: 'In progress', collapsedByDefault: false },
  { status: 'open', label: 'Open', collapsedByDefault: false },
  { status: 'done', label: 'Done', collapsedByDefault: true },
];

function QuickAddRow({ port, projectId }: { port: number; projectId: string }) {
  const quick = useQuickAddTodo(port, projectId);
  return (
    <div className="flex h-8 items-center gap-2 rounded-md px-2 transition-colors focus-within:bg-sidebar-accent">
      <Plus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
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

function TaskList({ port, projectId }: { port: number; projectId: string }) {
  const load = useTodosStore((s) => s.load);
  const move = useTodosStore((s) => s.move);
  const { todos, loading } = useTodosStore(selectProjectTodos(projectId));
  const openEdit = useTasksModal((s) => s.openEdit);
  const startSession = useStartTodoSession(port, projectId);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.map((g) => [g.status, g.collapsedByDefault])),
  );

  useEffect(() => {
    void load(port, projectId);
  }, [port, projectId, load]);

  const byStatus = useMemo(() => {
    const map: Record<Todo['status'], Todo[]> = { open: [], in_progress: [], done: [] };
    for (const todo of todos) map[todo.status].push(todo);
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
                onCycle={(t) => void move(port, t.id, nextTodoStatus(t.status), projectId)}
                onEdit={(t) => openEdit({ projectId, todoId: t.id })}
                onStart={(t) => void startSession(t.id, t.status)}
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
  const scopedProject = useSessionFilters((s) => soleProjectId(s.filterProjectIds));
  const picked = useTasksSidebarScope((s) => s.projectId);
  const setPicked = useTasksSidebarScope((s) => s.setProjectId);
  const openModal = useTasksModal((s) => s.openModal);
  // The session scope wins; the local pick only fills in when it names no project.
  const candidate = scopedProject ?? picked;
  const projectId = candidate != null && projects.some((p) => p.id === candidate) ? candidate : null;

  return (
    <>
      <SidebarHeader className="gap-1">
        <div className="flex h-9 items-center justify-between pl-1">
          <span className="text-sm font-semibold">Tasks</span>
          <Hint label="Open the board">
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="tasks-sidebar-open-board"
              aria-label="Open the board"
              className="text-muted-foreground"
              onClick={openModal}
            >
              <LayoutGrid />
            </Button>
          </Hint>
        </div>
        {scopedProject == null && (
          <div className="flex h-8 items-center px-1">
            <ModalProjectPicker
              surface="tasks-sidebar"
              projectId={projectId}
              projects={projects}
              onSelect={setPicked}
            />
          </div>
        )}
        {projectId != null && <QuickAddRow port={port} projectId={projectId} />}
      </SidebarHeader>
      <SidebarScrollRegion>
        <div className="px-2">
          {projectId == null ? (
            <div data-testid="tasks-sidebar-no-project" className="px-2 py-6 text-center text-xs text-muted-foreground">
              Pick a project to see its tasks.
            </div>
          ) : (
            <TaskList port={port} projectId={projectId} />
          )}
        </div>
      </SidebarScrollRegion>
    </>
  );
}
