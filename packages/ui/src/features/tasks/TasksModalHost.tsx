/**
 * TasksModalHost — single app-root host for the Tasks full-view modal and
 * the QuickTaskDialog. Driven by useTasksModal (zustand store).
 *
 * Each dialog holds its own per-open project scope, seeded from the sidebar
 * filter on the rising edge of its own open. The two never share a pick, and
 * neither follows a background session switch. Opening always produces a
 * surface: with no project resolved the dialog shows the project list instead
 * of the board, so the sidebar entry and ⌘⇧T can no longer be dead clicks.
 *
 * Registers ⌘⇧T → openQuick(). Listens for `mf:open-tasks` (dispatched by
 * SidebarHeader TasksBtn). Mounted once in AppShell's outlet block — so unlike
 * `useModalProjectScope`'s own internal instance (reloaded per hook, per
 * open), this component's top-level `useProjects()` never remounts and never
 * refetches on its own. Without an explicit reload here, a project added
 * after boot stays permanently absent from `projects` below: `known()` keeps
 * rejecting it and the pick list never lists it, however many times the modal
 * reopens. Reloading on the rising edge of either dialog keeps it current.
 */
import React, { useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useShortcutAction } from '@/features/shortcuts/action-store';
import { soleProjectId, useSessionFilters } from '@/store/session-filters';
import { useProjects } from '@/features/sessions/use-projects';
import { useModalProjectScope } from '@/features/project-scope/use-modal-project-scope';
import { ProjectPickList } from '@/features/project-scope/ProjectPickList';
import { useTasksModal } from './use-tasks-modal';
import { useStartTodoSession } from './use-start-todo-session';
import { useTodosStore } from './use-todos-store';
import { TasksBoard } from './TasksBoard';
import { QuickTaskDialog } from './QuickTaskDialog';

interface Props {
  port: number;
}

export function TasksModalHost({ port }: Props): React.ReactElement {
  const { open, quickOpen, closeModal, openModal, openQuick, closeQuick } = useTasksModal();
  const { projects, reloadProjects } = useProjects();
  const filterProjectId = useSessionFilters((s) => soleProjectId(s.filterProjectIds));
  const board = useModalProjectScope(open);
  const quick = useModalProjectScope(quickOpen);
  const view = useTodosStore((s) => s.view);

  // Rising edge of EITHER dialog — this instance's own list, not the scope
  // hook's internal one, is what `known()`/the pick list/the board below read.
  const reloadProjectsRef = React.useRef(reloadProjects);
  reloadProjectsRef.current = reloadProjects;
  const anyOpenRef = React.useRef(false);
  useEffect(() => {
    const anyOpen = open || quickOpen;
    if (anyOpen && !anyOpenRef.current) void reloadProjectsRef.current();
    anyOpenRef.current = anyOpen;
  }, [open, quickOpen]);

  // A project deleted while a modal is open leaves its scope pointing at
  // nothing; falling back to the pick list keeps the surface honest without an
  // effect racing the render.
  const known = (id: string | null): string | null =>
    id !== null && projects.some((project) => project.id === id) ? id : null;
  const boardProjectId = known(board.projectId);
  const quickProjectId = known(quick.projectId);

  const startSession = useStartTodoSession(port, boardProjectId ?? undefined);

  useShortcutAction('app.quick-task', openQuick);

  // mf:open-tasks custom event (dispatched by SidebarHeader TasksBtn)
  useEffect(() => {
    function handleOpenTasks() {
      openModal();
    }
    window.addEventListener('mf:open-tasks', handleOpenTasks);
    return () => window.removeEventListener('mf:open-tasks', handleOpenTasks);
  }, [openModal]);

  return (
    <>
      {/* Full-view Tasks modal */}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) closeModal();
        }}
      >
        <DialogContent
          showCloseButton={boardProjectId === null}
          className={cn(
            boardProjectId === null
              ? 'sm:max-w-sm'
              : 'flex max-h-[85vh] min-h-[480px] w-full flex-col gap-0 p-0 transition-[width] duration-[180ms] ease-out',
            boardProjectId !== null && (view === 'list' ? 'sm:max-w-[880px]' : 'w-[90vw] sm:max-w-[1200px]'),
          )}
        >
          {boardProjectId === null ? (
            <>
              <DialogHeader>
                <DialogTitle>Tasks</DialogTitle>
                <DialogDescription>Pick the project whose board you want to open.</DialogDescription>
              </DialogHeader>
              <ProjectPickList
                surface="tasks-board"
                projects={projects}
                filterProjectId={filterProjectId}
                onSelect={board.setProjectId}
              />
            </>
          ) : (
            <>
              <DialogHeader className="sr-only">
                <DialogTitle>Tasks</DialogTitle>
              </DialogHeader>
              <TasksBoard
                port={port}
                projectId={boardProjectId}
                projects={projects}
                onProjectChange={board.setProjectId}
                onClose={closeModal}
                onStartSession={(todo) => {
                  closeModal();
                  void startSession(todo.id, todo.status);
                }}
              />
            </>
          )}
        </DialogContent>
      </Dialog>

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
