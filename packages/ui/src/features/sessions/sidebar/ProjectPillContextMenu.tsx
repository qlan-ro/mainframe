/**
 * ProjectPillContextMenu — one project row in the switcher list, with the
 * right-click Rename (disabled)/Remove menu. Restyled from a pill to a
 * full-width row (2026-07 rebuild) — a colored initial avatar replaces the
 * bare label, and the row fills the switcher list's width instead of
 * shrink-wrapping. Remove is offered twice — a hover-revealed button on the row
 * (the primary, discoverable entry point) and the right-click menu — both routed
 * through the same handler. `onRemoveProject` is optional: when omitted (no
 * remove handler wired up) the row renders bare, with neither affordance.
 */
import type { Project } from '@qlan-ro/mainframe-types';
import { forwardRef, type HTMLAttributes } from 'react';
import { PencilIcon, Trash2Icon } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { CountBadge } from '@/components/ui/count-badge';
import { DismissibleHint } from '@/components/ui/hint';
import { useUiPrefs } from '@/store/ui-prefs';
import { ProjectAvatar } from './ProjectAvatar';

interface ProjectPillContextMenuProps {
  project: Project;
  active: boolean;
  badgeCount?: number;
  badgeTestId?: string;
  /** Deterministic per-project identity color (project-color.ts) — paints the avatar. */
  avatarColor: string;
  onSelect: () => void;
  onRemoveProject?: (project: Project) => void;
}

interface ProjectRowBodyProps extends HTMLAttributes<HTMLDivElement> {
  project: Project;
  active: boolean;
  badgeCount: number;
  badgeTestId?: string;
  avatarColor: string;
  onSelect: () => void;
  onRemove?: () => void;
}

const REMOVE_LABEL = 'Remove Project';
const RENAME_LABEL = 'Rename Project';
const HINT_LABEL = 'Right-click for options';

const ProjectRowBody = forwardRef<HTMLDivElement, ProjectRowBodyProps>(function ProjectRowBody(
  { project, active, badgeCount, badgeTestId, avatarColor, onSelect, onRemove, className, ...props },
  ref,
) {
  const containerClass = [
    'group flex h-[28px] w-full items-center rounded-md transition-colors',
    active ? 'bg-mf-selection text-primary' : 'text-foreground hover:bg-accent',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={ref} data-testid={`sessions-filter-pill-${project.id}-wrap`} className={containerClass} {...props}>
      <button
        data-testid={`sessions-filter-pill-${project.id}`}
        aria-pressed={active}
        onClick={onSelect}
        type="button"
        className="flex h-full min-w-0 flex-1 items-center gap-[9px] px-[12px] text-label font-medium tracking-normal"
      >
        <span data-testid={`sessions-filter-pill-avatar-${project.id}`}>
          <ProjectAvatar name={project.name} color={avatarColor} />
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{project.name}</span>
        {badgeTestId != null && (
          <CountBadge count={badgeCount} variant="unread" onAccent={active} data-testid={badgeTestId} />
        )}
      </button>
      {onRemove != null && (
        <button
          data-testid={`sessions-project-remove-action-${project.id}`}
          type="button"
          aria-label={REMOVE_LABEL}
          onClick={(e) => {
            // The row's select button is a sibling, but the whole row is also the
            // context-menu trigger — stop both from reacting to this click.
            e.stopPropagation();
            e.preventDefault();
            onRemove();
          }}
          className="mr-[6px] hidden size-[22px] flex-shrink-0 items-center justify-center rounded-xs text-muted-foreground transition-colors group-hover:flex hover:bg-accent hover:text-destructive"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      )}
    </div>
  );
});

export function ProjectPillContextMenu({
  project,
  active,
  badgeCount = 0,
  badgeTestId,
  avatarColor,
  onSelect,
  onRemoveProject,
}: ProjectPillContextMenuProps) {
  const hintDismissed = useUiPrefs((s) => s.rightClickHintDismissed);
  const dismissHint = useUiPrefs((s) => s.dismissRightClickHint);
  const removeProject = onRemoveProject == null ? undefined : () => onRemoveProject(project);

  const body = (
    <ProjectRowBody
      project={project}
      active={active}
      badgeCount={badgeCount}
      badgeTestId={badgeTestId}
      avatarColor={avatarColor}
      onSelect={onSelect}
      onRemove={removeProject}
    />
  );

  if (removeProject == null) return body;

  return (
    <ContextMenu>
      <DismissibleHint
        label={HINT_LABEL}
        dismissed={hintDismissed}
        onDismiss={dismissHint}
        dismissTestId="sessions-pill-hint-dismiss"
      >
        <ContextMenuTrigger asChild>{body}</ContextMenuTrigger>
      </DismissibleHint>
      <ContextMenuContent className="w-44">
        <ContextMenuItem data-testid={`sessions-project-rename-${project.id}`} disabled>
          <PencilIcon className="mr-2 size-3.5" />
          {RENAME_LABEL}
        </ContextMenuItem>
        <ContextMenuItem
          data-testid={`sessions-project-remove-${project.id}`}
          variant="destructive"
          onSelect={removeProject}
        >
          <Trash2Icon className="mr-2 size-3.5" />
          {REMOVE_LABEL}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
