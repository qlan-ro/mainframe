/**
 * TasksModalHost — single app-root host for the Tasks full-view modal and
 * the QuickTaskDialog. Driven by useTasksModal (zustand store).
 *
 * Resolves projectId from useActiveIdentity(). Registers the ⌘⇧T shortcut's action.
 * Listens for `mf:open-tasks` custom event (dispatched by SidebarHeader TasksBtn).
 * Loads on mount (so the first open has data) and refetches on the
 * open/quick-add rising edge (so externally-made changes are reflected — the
 * todos store has no WS event).
 * Mounted once in AppShell's outlet block.
 */
import React, { useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useShortcutAction } from '@/features/shortcuts/action-store';
import { useTasksModal } from './use-tasks-modal';
import { useStartTodoSession } from './use-start-todo-session';
import { useTodosStore } from './use-todos-store';
import { TasksBoard } from './TasksBoard';
import { QuickTaskDialog } from './QuickTaskDialog';

interface Props {
  port: number;
}

export function TasksModalHost({ port }: Props): React.ReactElement | null {
  const { open, quickOpen, closeModal, openModal, openQuick, closeQuick } = useTasksModal();
  const { projectId } = useActiveIdentity();
  const startSession = useStartTodoSession(port, projectId);
  const { load, view } = useTodosStore();
  const prevQuick = useRef(false);

  // Eagerly load todos so the modal and quick-add show correct data the
  // first time either one opens.
  useEffect(() => {
    if (!projectId || !port) return;
    void load(port, projectId);
  }, [port, projectId, load]);

  // Refetch on the quick-add rising edge. The store has no WS event
  // (single-window refetch-on-mutation), so a change made outside this window
  // — agent sessions, another window, direct DB writes — would otherwise show
  // boot-time statuses. The full modal needs no edge here: TasksBoard mounts
  // fresh on each open (Radix unmounts DialogContent) and loads itself.
  useEffect(() => {
    if (!projectId || !port) return;
    const justOpened = quickOpen && !prevQuick.current;
    prevQuick.current = quickOpen;
    if (justOpened) void load(port, projectId);
  }, [quickOpen, projectId, port, load]);

  useShortcutAction('app.quick-task', openQuick);

  // mf:open-tasks custom event (dispatched by SidebarHeader TasksBtn)
  useEffect(() => {
    function handleOpenTasks() {
      openModal();
    }
    window.addEventListener('mf:open-tasks', handleOpenTasks);
    return () => window.removeEventListener('mf:open-tasks', handleOpenTasks);
  }, [openModal]);

  if (!projectId) return null;

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
          showCloseButton={false}
          className={cn(
            'flex max-h-[85vh] min-h-[480px] w-full flex-col gap-0 p-0 transition-[width] duration-[180ms] ease-out',
            view === 'list' ? 'sm:max-w-[880px]' : 'w-[90vw] sm:max-w-[1200px]',
          )}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Tasks</DialogTitle>
          </DialogHeader>
          <TasksBoard
            port={port}
            projectId={projectId}
            onClose={closeModal}
            onStartSession={(todo) => {
              closeModal();
              void startSession(todo.id, todo.status);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Quick-add dialog */}
      <QuickTaskDialog port={port} projectId={projectId} open={quickOpen} onClose={closeQuick} />
    </>
  );
}
