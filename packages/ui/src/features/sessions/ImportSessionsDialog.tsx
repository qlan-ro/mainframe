/**
 * Import external sessions — CLI transcripts that exist on disk but have never
 * been adopted as Mainframe chats.
 *
 * Two steps, because discovery is per project: pick the project, then the
 * transcript. An active project filter already answers the first question, so
 * the dialog opens straight on the list and offers no Back.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Project } from '@qlan-ro/mainframe-types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { projectColor } from '@/features/sessions/sidebar/project-color';
import { ProjectAvatar } from './ProjectAvatar';
import { ImportSessionList } from './ImportSessionList';

interface ProjectPickerProps {
  projects: Project[];
  /** The filtered project sorts first — it is the likeliest target. */
  filterProjectId: string | null;
  onSelect: (projectId: string) => void;
}

function ProjectPicker({ projects, filterProjectId, onSelect }: ProjectPickerProps) {
  const sorted = useMemo(
    () =>
      [...projects].sort((a, b) => {
        if (a.id === filterProjectId) return -1;
        if (b.id === filterProjectId) return 1;
        return a.name.localeCompare(b.name);
      }),
    [projects, filterProjectId],
  );

  return (
    <div className="flex flex-col gap-0.5">
      {sorted.map((project) => (
        <Button
          key={project.id}
          data-testid={`sessions-import-project-${project.id}`}
          variant="ghost"
          size="sm"
          className="w-full justify-start font-normal"
          title={project.path}
          onClick={() => onSelect(project.id)}
        >
          <ProjectAvatar name={project.name} color={projectColor(project.id)} />
          <span className="min-w-0 truncate">{project.name}</span>
        </Button>
      ))}
    </div>
  );
}

interface ImportSessionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  port: number;
  projects: Project[];
  filterProjectId: string | null;
}

export function ImportSessionsDialog({
  open,
  onOpenChange,
  port,
  projects,
  filterProjectId,
}: ImportSessionsDialogProps) {
  const [projectId, setProjectId] = useState<string | null>(filterProjectId);

  // Reopening restarts the flow — a step-2 list left over from last time would
  // silently ignore a filter changed in between.
  useEffect(() => {
    if (open) setProjectId(filterProjectId);
  }, [open, filterProjectId]);

  const project = projects.find((p) => p.id === projectId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="sessions-import-dialog" className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Import external sessions</DialogTitle>
          <DialogDescription>
            {projectId === null ? 'Pick the project to import into.' : 'Sessions run outside Mainframe.'}
          </DialogDescription>
        </DialogHeader>

        {projectId === null ? (
          <ProjectPicker projects={projects} filterProjectId={filterProjectId} onSelect={setProjectId} />
        ) : (
          <ImportSessionList
            port={port}
            projectId={projectId}
            projectPath={project?.path}
            onDone={() => onOpenChange(false)}
            onBack={filterProjectId === null ? () => setProjectId(null) : undefined}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
