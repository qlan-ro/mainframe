/**
 * TasksModalHost — single app-root host for the Tasks full-view modal and
 * the QuickTaskDialog. Driven by useTasksModal (zustand store).
 *
 * Resolves projectId from useActiveIdentity(). Registers ⌘⇧T → openQuick().
 * Listens for `mf:open-tasks` custom event (dispatched by SidebarHeader TasksBtn).
 * Loads on mount (so the inspector drawer has data) and refetches on the
 * open/quick-add rising edge (so externally-made changes are reflected — the
 * todos store has no WS event).
 * Mounted once in AppShell's outlet block.
 */
import React, { useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
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
  const prevOpen = useRef(false);
  const prevQuick = useRef(false);

  // Eagerly load todos so modal and quick-add show correct data even when
  // the inspector drawer is hidden.
  useEffect(() => {
    if (!projectId || !port) return;
    void load(port, projectId);
  }, [port, projectId, load]);

  // Refetch on the open/quickOpen rising edge. The store has no WS event
  // (single-window refetch-on-mutation), so a change made outside this window
  // — agent sessions, another window, direct DB writes — would otherwise leave
  // the modal showing boot-time statuses. The store's _loadSeq guard keeps
  // concurrent loads safe; todos are not cleared, so the list stays rendered.
  useEffect(() => {
    if (!projectId || !port) return;
    const justOpened = (open && !prevOpen.current) || (quickOpen && !prevQuick.current);
    prevOpen.current = open;
    prevQuick.current = quickOpen;
    if (justOpened) void load(port, projectId);
  }, [open, quickOpen, projectId, port, load]);

  // ⌘⇧T → open quick-add dialog
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        openQuick();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openQuick]);

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
          hideClose
          className={cn(
            'w-full max-h-[85vh] flex flex-col p-0 gap-0 transition-[width] duration-[180ms] ease-out',
            view === 'list' ? 'max-w-[880px]' : 'max-w-[1200px] w-[90vw]',
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
