/**
 * What a modal shows when its scope resolves to no project: the list to pick
 * from, rather than an empty surface or a click that does nothing.
 *
 * The sidebar's filtered project sorts first — it is the likeliest target, the
 * same reasoning as the import dialog's picker.
 */
import { useMemo } from 'react';
import type { Project } from '@qlan-ro/mainframe-types';
import { FolderPlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { projectColor } from '@/features/sessions/sidebar/project-color';
import { ProjectAvatar } from '@/features/sessions/ProjectAvatar';

interface ProjectPickListProps {
  /** Testid prefix — one per modal, so two open lists stay addressable. */
  surface: string;
  projects: Project[];
  filterProjectId: string | null;
  onSelect: (projectId: string) => void;
}

export function ProjectPickList({ surface, projects, filterProjectId, onSelect }: ProjectPickListProps) {
  const sorted = useMemo(
    () =>
      [...projects].sort((a, b) => {
        if (a.id === filterProjectId) return -1;
        if (b.id === filterProjectId) return 1;
        return a.name.localeCompare(b.name);
      }),
    [projects, filterProjectId],
  );

  if (sorted.length === 0) {
    return (
      <div
        data-testid={`${surface}-project-pick-empty`}
        className="flex flex-col items-center justify-center gap-1.5 py-12 text-center"
      >
        <FolderPlusIcon size={26} className="text-muted-foreground/40" aria-hidden />
        <p className="text-sm font-semibold">No projects yet</p>
        <p className="text-xs text-muted-foreground">Add a project to start tracking tasks here.</p>
      </div>
    );
  }

  return (
    <div data-testid={`${surface}-project-pick`} className="flex flex-col gap-0.5">
      {sorted.map((project) => (
        <Hint key={project.id} label={project.path} side="right">
          <Button
            data-testid={`${surface}-project-${project.id}`}
            variant="ghost"
            size="sm"
            className="w-full justify-start font-normal"
            onClick={() => onSelect(project.id)}
          >
            <ProjectAvatar name={project.name} color={projectColor(project.id)} />
            <span className="min-w-0 truncate">{project.name}</span>
          </Button>
        </Hint>
      ))}
    </div>
  );
}
