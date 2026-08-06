/**
 * One project in the switcher.
 *
 * Single-select, not a toggle: clicking a row always narrows to that project,
 * and only the "All projects" row clears the filter. Remove is offered twice —
 * hover-revealed on the row and in the right-click menu — through one handler;
 * with no handler wired the row renders bare, with neither affordance.
 */
import type { ReactNode } from 'react';
import type { Project } from '@qlan-ro/mainframe-types';
import { PencilIcon, Trash2Icon } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@v2/components/ui/context-menu';
import { DismissibleHint } from '@v2/components/ui/hint';
import { Badge } from '@v2/components/ui/badge';
import { SidebarMenuAction, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from '@v2/components/ui/sidebar';
import { cn } from '@v2/lib/utils';
import { projectColor } from '@/features/sessions/sidebar/project-color';
import { useUiPrefs } from '@/store/ui-prefs';
import { ProjectAvatar } from './ProjectAvatar';

const REMOVE_LABEL = 'Remove Project';
const RENAME_LABEL = 'Rename Project';

interface ProjectRowProps {
  project: Project;
  active: boolean;
  /** Sessions in this project wanting attention; 0 hides the badge. */
  attention: number;
  onSelect: () => void;
  onRemove?: () => void;
}

export function ProjectRow({ project, active, attention, onSelect, onRemove }: ProjectRowProps) {
  const hintDismissed = useUiPrefs((s) => s.rightClickHintDismissed);
  const dismissHint = useUiPrefs((s) => s.dismissRightClickHint);
  // Unavailable (directory missing on disk) renders muted with a badge but
  // stays selectable, so its sessions remain reachable.
  const unavailable = project.available === false;

  const row = (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        data-testid={`sidebar-project-${project.id}`}
        isActive={active}
        aria-pressed={active}
        tooltip={project.name}
        onClick={onSelect}
        className="data-active:bg-sidebar-selection data-active:text-primary"
      >
        <ProjectAvatar name={project.name} color={projectColor(project.id)} />
        {/* One resting ink: the avatar names the project and the badge counts it,
            so attention never needs the name to shout too. */}
        <span className={cn('min-w-0 flex-1 truncate-fade', (!active || unavailable) && 'text-muted-foreground')}>
          {project.name}
        </span>
        {unavailable && (
          <Badge
            variant="secondary"
            data-testid={`sidebar-project-unavailable-${project.id}`}
            className="h-4 shrink-0 px-1 text-[10px] font-normal text-muted-foreground"
          >
            Unavailable
          </Badge>
        )}
      </SidebarMenuButton>
      {attention > 0 && (
        // Badge and remove share the right gutter, so the badge yields on hover
        // the way the session row's meta cluster does.
        <SidebarMenuBadge
          data-testid={`sidebar-project-badge-${project.id}`}
          className={cn('text-primary', onRemove != null && 'transition-opacity group-hover/menu-item:opacity-0')}
        >
          {attention}
        </SidebarMenuBadge>
      )}
      {onRemove != null && (
        <SidebarMenuAction
          showOnHover
          data-testid={`sidebar-project-remove-${project.id}`}
          aria-label={REMOVE_LABEL}
          onClick={(e) => {
            // The row is also the context-menu trigger; neither it nor the
            // select button should react to this click.
            e.stopPropagation();
            e.preventDefault();
            onRemove();
          }}
          className="hover:text-destructive"
        >
          <Trash2Icon />
        </SidebarMenuAction>
      )}
    </SidebarMenuItem>
  );

  if (onRemove == null) return row;

  return (
    <ContextMenu>
      <DismissibleHint
        label="Right-click for options"
        dismissed={hintDismissed}
        onDismiss={dismissHint}
        dismissTestId="sidebar-project-hint-dismiss"
      >
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      </DismissibleHint>
      <ContextMenuContent className="w-44">
        <ContextMenuItem data-testid={`sidebar-project-rename-menu-${project.id}`} disabled>
          <PencilIcon />
          {RENAME_LABEL}
        </ContextMenuItem>
        <ContextMenuItem
          data-testid={`sidebar-project-remove-menu-${project.id}`}
          variant="destructive"
          onSelect={onRemove}
        >
          <Trash2Icon />
          {REMOVE_LABEL}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The neutral row above the projects: clears the filter. */
export function AllProjectsRow({
  active,
  attention,
  icon,
  onSelect,
}: {
  active: boolean;
  attention: number;
  icon: ReactNode;
  onSelect: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        data-testid="sidebar-project-all"
        isActive={active}
        aria-pressed={active}
        tooltip="All projects"
        onClick={onSelect}
        className="data-active:bg-sidebar-selection data-active:text-primary"
      >
        {/* Same 18px footprint as ProjectAvatar so the names line up, untinted
            since "All" belongs to no one project's colour. */}
        <span
          aria-hidden
          className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          {icon}
        </span>
        <span className={cn('min-w-0 flex-1 truncate-fade', !active && 'text-muted-foreground')}>All projects</span>
      </SidebarMenuButton>
      {attention > 0 && (
        <SidebarMenuBadge data-testid="sidebar-project-badge-all" className="text-primary">
          {attention}
        </SidebarMenuBadge>
      )}
    </SidebarMenuItem>
  );
}
