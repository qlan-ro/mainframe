import type { Project } from '@qlan-ro/mainframe-types';
import { forwardRef, type HTMLAttributes } from 'react';
import { ChevronDownIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ProjectPillContextMenuProps {
  project: Project;
  active: boolean;
  badgeCount?: number;
  badgeTestId?: string;
  onSelect: () => void;
  onRemoveProject: (project: Project) => void;
}

interface ProjectPillBodyProps extends HTMLAttributes<HTMLSpanElement> {
  project: Project;
  active: boolean;
  badgeCount: number;
  badgeTestId?: string;
  onSelect: () => void;
  onRemoveProject: () => void;
}

const REMOVE_LABEL = 'Remove Project';
const RENAME_LABEL = 'Rename Project';

function ProjectPillBadge({ active, count, testId }: { active: boolean; count: number; testId?: string }) {
  if (count <= 0 || testId == null) return null;
  const className = [
    'inline-flex h-4 min-w-4 items-center justify-center rounded-lg px-1 text-micro font-bold leading-none text-white',
    active ? 'bg-white/25' : 'bg-primary',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span data-testid={testId} className={className}>
      {count}
    </span>
  );
}

function ProjectRemoveDropdownItem({ projectId, onRemoveProject }: { projectId: string; onRemoveProject: () => void }) {
  return (
    <DropdownMenuItem
      data-testid={`sessions-project-remove-${projectId}`}
      className="text-destructive focus:bg-destructive/10 focus:text-destructive text-caption"
      onSelect={onRemoveProject}
    >
      <Trash2Icon className="mr-2 size-3.5 text-destructive" />
      {REMOVE_LABEL}
    </DropdownMenuItem>
  );
}

function ProjectRenameDropdownItem({ projectId }: { projectId: string }) {
  return (
    <DropdownMenuItem data-testid={`sessions-project-rename-${projectId}`} disabled className="text-caption">
      <PencilIcon className="mr-2 size-3.5" />
      {RENAME_LABEL}
    </DropdownMenuItem>
  );
}

function ProjectRemoveContextItem({ projectId, onRemoveProject }: { projectId: string; onRemoveProject: () => void }) {
  return (
    <ContextMenuItem
      data-testid={`sessions-project-remove-${projectId}`}
      variant="destructive"
      className="text-caption"
      onSelect={onRemoveProject}
    >
      <Trash2Icon className="mr-2 size-3.5" />
      {REMOVE_LABEL}
    </ContextMenuItem>
  );
}

function ProjectRenameContextItem({ projectId }: { projectId: string }) {
  return (
    <ContextMenuItem data-testid={`sessions-project-rename-${projectId}`} disabled className="text-caption">
      <PencilIcon className="mr-2 size-3.5" />
      {RENAME_LABEL}
    </ContextMenuItem>
  );
}

const ProjectPillBody = forwardRef<HTMLSpanElement, ProjectPillBodyProps>(function ProjectPillBody(
  { project, active, badgeCount, badgeTestId, onSelect, onRemoveProject, className, ...props },
  ref,
) {
  const containerClass = [
    'group relative inline-flex h-[24px] shrink-0 items-center overflow-hidden rounded-[12px] text-caption font-medium tracking-normal transition-colors',
    active ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground hover:text-foreground',
    className,
  ].join(' ');

  return (
    <span ref={ref} data-testid={`sessions-filter-pill-${project.id}-wrap`} className={containerClass} {...props}>
      <button
        data-testid={`sessions-filter-pill-${project.id}`}
        aria-pressed={active}
        onClick={onSelect}
        type="button"
        className="inline-flex h-full min-w-0 items-center gap-1.5 px-3 pr-2 transition-[padding] group-hover:pr-8 group-focus-within:pr-8"
      >
        <span className="max-w-[140px] truncate">{project.name}</span>
        <ProjectPillBadge active={active} count={badgeCount} testId={badgeTestId} />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            data-testid={`sessions-filter-pill-menu-${project.id}`}
            type="button"
            aria-label={`Project actions for ${project.name}`}
            className="absolute right-0 inline-flex h-full w-6 items-center justify-center border-l border-current/10 bg-inherit text-current/70 opacity-0 transition-opacity hover:text-current group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <ChevronDownIcon className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6} className="w-44">
          <ProjectRenameDropdownItem projectId={project.id} />
          <ProjectRemoveDropdownItem projectId={project.id} onRemoveProject={onRemoveProject} />
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
});

export function ProjectPillContextMenu({
  project,
  active,
  badgeCount = 0,
  badgeTestId,
  onSelect,
  onRemoveProject,
}: ProjectPillContextMenuProps) {
  const removeProject = () => onRemoveProject(project);
  const pill = (
    <ProjectPillBody
      project={project}
      active={active}
      badgeCount={badgeCount}
      badgeTestId={badgeTestId}
      onSelect={onSelect}
      onRemoveProject={removeProject}
    />
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{pill}</ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ProjectRenameContextItem projectId={project.id} />
        <ProjectRemoveContextItem projectId={project.id} onRemoveProject={removeProject} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
