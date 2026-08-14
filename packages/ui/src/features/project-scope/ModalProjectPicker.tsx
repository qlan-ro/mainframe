/**
 * The chip in a modal's header that names the project it is showing and changes
 * it. One picker for both sidebar modals, so the Kanban board and the
 * Automations library read the same way; the scope itself lives in the host's
 * `useModalProjectScope`.
 *
 * `allowAllProjects` decides what a null scope means: an unscoped view the user
 * can choose (Automations), or a project not picked yet (the board, whose
 * columns need one project).
 */
import type { Project } from '@qlan-ro/mainframe-types';
import { ChevronDownIcon, FolderOpenIcon, LayoutGridIcon } from 'lucide-react';
import { ProjectChip } from '@/components/ui/project-chip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { projectColor } from '@/features/sessions/sidebar/project-color';
import { ProjectAvatar } from '@/features/sessions/ProjectAvatar';
import { cn } from '@/lib/utils';

/** Same 18px footprint as ProjectAvatar so the names line up, untinted since
 *  "All" belongs to no one project's colour. */
function AllProjectsMark() {
  return (
    <span
      aria-hidden
      className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
    >
      <LayoutGridIcon className="size-3" />
    </span>
  );
}

function TriggerLabel({
  projectId,
  projectName,
  allowAllProjects,
}: {
  projectId: string | null;
  projectName: string | null;
  allowAllProjects: boolean;
}) {
  if (projectId !== null && projectName !== null) {
    return <ProjectChip projectId={projectId} name={projectName} size={18} />;
  }
  if (allowAllProjects) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium">
        <LayoutGridIcon size={14} aria-hidden />
        All projects
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
      <FolderOpenIcon size={14} aria-hidden />
      Choose a project
    </span>
  );
}

interface ModalProjectPickerProps {
  /** Testid prefix — one per modal, so two open pickers stay addressable. */
  surface: string;
  projectId: string | null;
  projects: Project[];
  onSelect: (id: string | null) => void;
  allowAllProjects?: boolean;
  /** Names the project without offering the change — for sub-views that would
   *  re-scope under their own open editor. */
  disabled?: boolean;
}

export function ModalProjectPicker({
  surface,
  projectId,
  projects,
  onSelect,
  allowAllProjects = false,
  disabled = false,
}: ModalProjectPickerProps) {
  const projectName = projectId === null ? null : (projects.find((p) => p.id === projectId)?.name ?? projectId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          data-testid={`${surface}-project-picker`}
          disabled={disabled}
          className={cn(
            'inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors',
            !disabled && 'hover:bg-muted',
          )}
        >
          <TriggerLabel projectId={projectId} projectName={projectName} allowAllProjects={allowAllProjects} />
          {!disabled && <ChevronDownIcon size={12} className="text-muted-foreground" aria-hidden />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent data-testid={`${surface}-project-picker-menu`} align="start" sideOffset={6} className="w-60">
        {allowAllProjects && (
          <DropdownMenuItem data-testid={`${surface}-project-all`} onSelect={() => onSelect(null)}>
            <AllProjectsMark />
            <span className="min-w-0 flex-1 truncate">All projects</span>
          </DropdownMenuItem>
        )}
        {projects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            data-testid={`${surface}-project-${project.id}`}
            onSelect={() => onSelect(project.id)}
          >
            <ProjectAvatar name={project.name} color={projectColor(project.id)} />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
          </DropdownMenuItem>
        ))}
        {projects.length === 0 && (
          <DropdownMenuItem data-testid={`${surface}-project-picker-empty`} disabled>
            <span className="text-muted-foreground">No projects yet</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
