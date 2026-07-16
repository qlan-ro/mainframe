/**
 * ProjectPillContextMenu — one project row in the switcher list, with the
 * right-click Rename (disabled)/Remove menu. Restyled from a pill to a
 * full-width row (2026-07 rebuild) — a colored initial avatar replaces the
 * bare label, and the row fills the switcher list's width instead of
 * shrink-wrapping. `onRemoveProject` is optional: when omitted (no remove
 * handler wired up) the row renders bare, with no context-menu wrapper.
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
}

const REMOVE_LABEL = 'Remove Project';
const RENAME_LABEL = 'Rename Project';
const HINT_LABEL = 'Right-click for options';

const ProjectRowBody = forwardRef<HTMLDivElement, ProjectRowBodyProps>(function ProjectRowBody(
  { project, active, badgeCount, badgeTestId, avatarColor, onSelect, className, ...props },
  ref,
) {
  // Mirrors SessionRow's title convention: full-strength foreground is the
  // UNREAD signal, never the resting state. Rest is muted (matching the "All"
  // and "Add project" rows above); a project with unread sessions goes bold
  // foreground; active wins over both.
  const hasUnread = badgeCount > 0;
  const containerClass = [
    'flex h-[28px] w-full items-center rounded-md transition-colors',
    active ? 'bg-mf-selection' : 'hover:bg-accent',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const nameClass = active
    ? 'text-primary font-medium'
    : hasUnread
      ? 'text-foreground font-bold'
      : 'text-muted-foreground font-medium';

  return (
    <div ref={ref} data-testid={`sessions-filter-pill-${project.id}-wrap`} className={containerClass} {...props}>
      <button
        data-testid={`sessions-filter-pill-${project.id}`}
        aria-pressed={active}
        onClick={onSelect}
        type="button"
        className="flex h-full min-w-0 flex-1 items-center gap-[9px] px-[12px] text-label tracking-normal"
      >
        <span data-testid={`sessions-filter-pill-avatar-${project.id}`}>
          <ProjectAvatar name={project.name} color={avatarColor} />
        </span>
        <span className={`min-w-0 flex-1 truncate text-left ${nameClass}`}>{project.name}</span>
        {badgeTestId != null && (
          <CountBadge count={badgeCount} variant="unread" onAccent={active} data-testid={badgeTestId} />
        )}
      </button>
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

  const body = (
    <ProjectRowBody
      project={project}
      active={active}
      badgeCount={badgeCount}
      badgeTestId={badgeTestId}
      avatarColor={avatarColor}
      onSelect={onSelect}
    />
  );

  if (onRemoveProject == null) return body;
  const removeProject = () => onRemoveProject(project);

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
