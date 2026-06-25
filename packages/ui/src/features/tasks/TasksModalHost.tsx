/**
 * TasksModalHost — single app-root host for the Tasks full-view modal and
 * the QuickTaskDialog. Driven by useTasksModal (zustand store).
 *
 * Resolves projectId from useActiveIdentity(). Registers ⌘⇧T → openQuick().
 * Listens for `mf:open-tasks` custom event (dispatched by SidebarHeader TasksBtn).
 * Triggers a load() on mount so the modal shows correct data even when the
 * inspector drawer is hidden.
 * Mounted once in AppShell's outlet block.
 */
import React, { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
  const { load } = useTodosStore();

  // Eagerly load todos so modal and quick-add show correct data even when
  // the inspector drawer is hidden.
  useEffect(() => {
    if (!projectId || !port) return;
    void load(port, projectId);
  }, [port, projectId, load]);

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
        <DialogContent hideClose className="max-w-4xl w-full max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Tasks</DialogTitle>
          </DialogHeader>
          <TasksBoard
            port={port}
            projectId={projectId}
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
