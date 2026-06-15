/**
 * TasksModalHost — single app-root host for the Tasks full-view modal and
 * the QuickTaskDialog. Driven by useTasksModal (zustand store).
 *
 * Resolves projectId from useActiveIdentity(). Registers ⌘⇧T → openQuick().
 * Mounted once in AppShell's outlet block.
 */
import React, { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useTasksModal } from './use-tasks-modal';
import { TasksBoard } from './TasksBoard';
import { QuickTaskDialog } from './QuickTaskDialog';
import type { Todo } from '@/lib/api/todos';

interface Props {
  port: number;
  onStartSession?: (todo: Todo) => void;
}

export function TasksModalHost({ port, onStartSession }: Props): React.ReactElement | null {
  const { open, quickOpen, closeModal, openQuick, closeQuick } = useTasksModal();
  const { projectId } = useActiveIdentity();

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
        <DialogContent className="max-w-4xl w-full max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Tasks</DialogTitle>
          </DialogHeader>
          <TasksBoard
            port={port}
            projectId={projectId}
            onStartSession={(todo) => {
              closeModal();
              onStartSession?.(todo);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Quick-add dialog */}
      <QuickTaskDialog port={port} projectId={projectId} open={quickOpen} onClose={closeQuick} />
    </>
  );
}
