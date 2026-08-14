/**
 * QuickTaskDialog — ⌘⇧T quick-add. The frame around QuickTaskForm, and the
 * one place that answers "which project does this task go to".
 *
 * `projectId` is the host's per-open scope and may be null — no project
 * resolved. The dialog then offers the project list in place of the form,
 * inside the same Dialog: swapping the Dialog root while it closes is what
 * leaves `pointer-events: none` on the body.
 *
 * Port of packages/app-electron/…/todos/QuickTodoDialog.tsx.
 * Rebuilt on shadcn/ui Dialog + warm-chrome tokens; no mf-* phantom classes.
 */
import type { Project } from '@qlan-ro/mainframe-types';
import { Zap } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ProjectChip } from '@/components/ui/project-chip';
import { ProjectPickList } from '@/features/project-scope/ProjectPickList';
import { QuickTaskForm } from './QuickTaskForm';

interface Props {
  port: number;
  /** The host's per-open scope; null when no project resolved. */
  projectId: string | null;
  projects: Project[];
  filterProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  open: boolean;
  onClose: () => void;
}

export function QuickTaskDialog({ port, projectId, projects, filterProjectId, onSelectProject, open, onClose }: Props) {
  const projectName = projects.find((project) => project.id === projectId)?.name ?? projectId ?? '';

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        data-testid="tasks-quick-dialog"
        className={projectId === null ? 'sm:max-w-sm' : 'max-w-md w-full max-h-[90vh] flex flex-col p-0 gap-0'}
        closeButtonClassName={projectId === null ? undefined : 'top-1.5'}
      >
        {/* pr-12 clears the stock close button. */}
        <DialogHeader className={projectId === null ? undefined : 'shrink-0 border-b px-4 py-3 pr-12'}>
          <div className="flex min-w-0 items-center gap-2">
            <DialogTitle className="flex shrink-0 items-center gap-1.5">
              <Zap size={13} className="text-primary shrink-0" aria-hidden />
              Quick Task
            </DialogTitle>
            {projectId !== null && (
              <ProjectChip data-testid="tasks-quick-project" projectId={projectId} name={projectName} size={18} />
            )}
          </div>
          {projectId === null && <DialogDescription>Pick the project to add this task to.</DialogDescription>}
        </DialogHeader>

        {projectId === null ? (
          <ProjectPickList
            surface="tasks-quick"
            projects={projects}
            filterProjectId={filterProjectId}
            onSelect={onSelectProject}
          />
        ) : (
          <QuickTaskForm port={port} projectId={projectId} open={open} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}
