import type { Project } from '@qlan-ro/mainframe-types';
import { forwardRef, type HTMLAttributes } from 'react';
import { PencilIcon, Trash2Icon } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { DismissibleHint } from '@/components/ui/hint';
import { useUiPrefs } from '@/store/ui-prefs';

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
}

const REMOVE_LABEL = 'Remove Project';
const RENAME_LABEL = 'Rename Project';
const HINT_LABEL = 'Right-click for options';

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
  { project, active, badgeCount, badgeTestId, onSelect, className, ...props },
  ref,
) {
  const containerClass = [
    'inline-flex h-[24px] shrink-0 items-center overflow-hidden rounded-[12px] text-caption font-medium tracking-normal transition-colors',
    active ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground hover:text-foreground',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span ref={ref} data-testid={`sessions-filter-pill-${project.id}-wrap`} className={containerClass} {...props}>
      <button
        data-testid={`sessions-filter-pill-${project.id}`}
        aria-pressed={active}
        onClick={onSelect}
        type="button"
        className="inline-flex h-full min-w-0 items-center gap-1.5 px-3"
      >
        <span className="max-w-[140px] truncate">{project.name}</span>
        <ProjectPillBadge active={active} count={badgeCount} testId={badgeTestId} />
      </button>
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
  const hintDismissed = useUiPrefs((s) => s.rightClickHintDismissed);
  const dismissHint = useUiPrefs((s) => s.dismissRightClickHint);

  return (
    <ContextMenu>
      <DismissibleHint
        label={HINT_LABEL}
        dismissed={hintDismissed}
        onDismiss={dismissHint}
        dismissTestId="sessions-pill-hint-dismiss"
      >
        <ContextMenuTrigger asChild>
          <ProjectPillBody
            project={project}
            active={active}
            badgeCount={badgeCount}
            badgeTestId={badgeTestId}
            onSelect={onSelect}
          />
        </ContextMenuTrigger>
      </DismissibleHint>
      <ContextMenuContent className="w-44">
        <ProjectRenameContextItem projectId={project.id} />
        <ProjectRemoveContextItem projectId={project.id} onRemoveProject={removeProject} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
