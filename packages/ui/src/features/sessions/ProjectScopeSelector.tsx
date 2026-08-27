/**
 * The project scope selector — the header dropdown that replaced the inline
 * projects list (2026-08-27).
 *
 * Scope, not switcher: any number of projects can be checked and the sessions
 * list shows their union; an empty scope is "All projects". Toggling never
 * activates a session — the list narrows, the active thread stays. The menu
 * stays open across toggles (multi-select), so each pick is one click, not
 * open-pick-reopen.
 *
 * The trigger's count badge is the attention hidden BY the scope (sum over
 * unchecked projects) — unscoped, nothing is hidden and no badge shows. The
 * hover ✕ clears the whole scope without opening the menu; it swaps in for the
 * chevron so the trigger never grows a second trailing slot. Add-project stays
 * a standalone button in the "Scope" label row (the same label+actions shape
 * as the Sessions section): it keeps its one-click path, its first-run tour
 * anchor, and the e2e testid.
 */
import type { Project } from '@qlan-ro/mainframe-types';
import { ChevronsUpDownIcon, FolderPlus, LayoutGridIcon, Trash2Icon, XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Hint } from '@/components/ui/hint';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { projectColor } from '@/features/sessions/sidebar/project-color';
import { ProjectAvatar } from './ProjectAvatar';

interface ProjectScopeSelectorProps {
  projects: Project[];
  /** Per-project count of sessions wanting attention; 0 hides the badge. */
  attention: Record<string, number>;
  /** The scoped project ids; empty = all projects. */
  scope: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
  onRemoveProject?: (project: Project) => void;
  onAddProject?: () => void;
}

export function ProjectScopeSelector(props: ProjectScopeSelectorProps) {
  const { projects, attention, scope, onAddProject } = props;
  // What the scope hides: attention in the UNCHECKED projects. Unscoped, the
  // list below shows everything, so there is nothing to summarize.
  const hiddenAttention =
    scope.size === 0 ? 0 : projects.reduce((sum, p) => (scope.has(p.id) ? sum : sum + (attention[p.id] ?? 0)), 0);

  return (
    <SidebarGroup className="p-0" data-testid="sidebar-scope-section">
      <SidebarGroupLabel>
        <span className="min-w-0 flex-1 truncate">Scope</span>
        {onAddProject != null && (
          <span className="flex shrink-0 items-center gap-0.5">
            <Hint label="Add project">
              <Button
                variant="ghost"
                size="icon-sm"
                data-testid="sidebar-projects-add"
                data-tut="add-project"
                aria-label="Add project"
                className="size-6 shrink-0 text-muted-foreground"
                onClick={onAddProject}
              >
                <FolderPlus />
              </Button>
            </Hint>
          </span>
        )}
      </SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <ScopeTrigger projects={projects} scope={scope} hiddenAttention={hiddenAttention} onClear={props.onClear} />
            <ScopeMenu {...props} />
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}

function ScopeTrigger({
  projects,
  scope,
  hiddenAttention,
  onClear,
}: {
  projects: Project[];
  scope: ReadonlySet<string>;
  hiddenAttention: number;
  onClear: () => void;
}) {
  const scoped = scope.size > 0;
  return (
    <DropdownMenuTrigger asChild>
      <SidebarMenuButton
        size="sm"
        data-testid="sidebar-project-scope-trigger"
        aria-label="Project scope"
        className="data-[state=open]:bg-sidebar-accent"
      >
        <TriggerLabel projects={projects} scope={scope} />
        {hiddenAttention > 0 && (
          <span data-testid="sidebar-project-scope-badge" className="shrink-0 text-xs text-primary tabular-nums">
            {hiddenAttention}
          </span>
        )}
        <ChevronsUpDownIcon
          className={cn('shrink-0 text-muted-foreground', scoped && 'group-hover/menu-item:hidden')}
        />
        {scoped && (
          // A span, not a nested button (invalid inside the trigger):
          // pointerdown fires before the menu opens, so stopping it there
          // clears without opening. Keyboard users clear via "All projects".
          <span
            role="button"
            aria-label="Clear project scope"
            data-testid="sidebar-project-scope-clear"
            className="hidden shrink-0 text-muted-foreground hover:text-foreground group-hover/menu-item:inline-flex"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClear();
            }}
          >
            <XIcon className="size-3.5" />
          </span>
        )}
      </SidebarMenuButton>
    </DropdownMenuTrigger>
  );
}

/** What the trigger shows for the current scope. */
function TriggerLabel({ projects, scope }: { projects: Project[]; scope: ReadonlySet<string> }) {
  const scoped = projects.filter((p) => scope.has(p.id));
  const only = scoped.length === 1 ? scoped[0] : undefined;
  if (only != null) {
    return (
      <>
        <ProjectAvatar name={only.name} color={projectColor(only.id)} />
        <span className="min-w-0 flex-1 truncate-fade">{only.name}</span>
      </>
    );
  }
  if (scoped.length === 0) {
    return (
      <>
        <span
          aria-hidden
          className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <LayoutGridIcon className="size-3" />
        </span>
        <span className="min-w-0 flex-1 truncate-fade">All projects</span>
      </>
    );
  }
  return (
    <>
      {/* bg-sidebar under each avatar keeps the overlap legible on hover fills. */}
      <span className="flex shrink-0 -space-x-1.5">
        {scoped.slice(0, 3).map((p) => (
          <span key={p.id} className="rounded-full bg-sidebar">
            <ProjectAvatar name={p.name} color={projectColor(p.id)} />
          </span>
        ))}
      </span>
      <span className="min-w-0 flex-1 truncate-fade">{scoped.length} projects</span>
    </>
  );
}

function ScopeMenu({
  projects,
  attention,
  scope,
  onToggle,
  onClear,
  onRemoveProject,
  onAddProject,
}: ProjectScopeSelectorProps) {
  return (
    <DropdownMenuContent data-testid="sidebar-project-scope-menu" align="start" sideOffset={6} className="w-56">
      <DropdownMenuCheckboxItem
        data-testid="sidebar-project-all"
        checked={scope.size === 0}
        onSelect={(e) => e.preventDefault()}
        onCheckedChange={() => onClear()}
      >
        <span className="min-w-0 flex-1 truncate">All projects</span>
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      {projects.map((project) => (
        <ProjectScopeItem
          key={project.id}
          project={project}
          checked={scope.has(project.id)}
          attention={attention[project.id] ?? 0}
          onToggle={() => onToggle(project.id)}
          onRemove={onRemoveProject == null ? undefined : () => onRemoveProject(project)}
        />
      ))}
      {onAddProject != null && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem data-testid="sidebar-project-scope-add" onSelect={onAddProject}>
            <FolderPlus />
            Add project
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  );
}

function ProjectScopeItem({
  project,
  checked,
  attention,
  onToggle,
  onRemove,
}: {
  project: Project;
  checked: boolean;
  attention: number;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  // Unavailable (directory missing on disk) renders muted with a badge but
  // stays checkable, so its sessions remain reachable.
  const unavailable = project.available === false;

  return (
    <DropdownMenuCheckboxItem
      data-testid={`sidebar-project-${project.id}`}
      checked={checked}
      // preventDefault keeps the menu open: scope-building is several picks.
      onSelect={(e) => e.preventDefault()}
      onCheckedChange={onToggle}
      className="group/scope-item"
    >
      <ProjectAvatar name={project.name} color={projectColor(project.id)} />
      <span className={cn('min-w-0 flex-1 truncate', unavailable && 'text-muted-foreground')}>{project.name}</span>
      {unavailable && (
        <Badge
          variant="secondary"
          data-testid={`sidebar-project-unavailable-${project.id}`}
          className="h-4 shrink-0 px-1 text-[10px] font-normal text-muted-foreground"
        >
          Unavailable
        </Badge>
      )}
      {attention > 0 && (
        <span
          data-testid={`sidebar-project-badge-${project.id}`}
          className={cn(
            'shrink-0 text-xs text-primary tabular-nums',
            onRemove != null && 'group-hover/scope-item:hidden',
          )}
        >
          {attention}
        </span>
      )}
      {onRemove != null && (
        // Same span-not-button rationale as the trigger's clear ✕.
        <span
          role="button"
          aria-label="Remove Project"
          data-testid={`sidebar-project-remove-${project.id}`}
          className="hidden shrink-0 text-muted-foreground hover:text-destructive group-hover/scope-item:inline-flex"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
        >
          <Trash2Icon className="size-3.5" />
        </span>
      )}
    </DropdownMenuCheckboxItem>
  );
}
