/**
 * ScopeStrip — the project scope as a row of stacked avatars (replaces the
 * "Scope" dropdown). Scope, not switcher: any number of projects can be in
 * scope and the sessions list shows their union; an empty scope is "All
 * projects". Toggling never activates a session.
 *
 * Avatars stack at a −6px overlap, up to six then "+N"; the ones in scope
 * carry a `primary` ring and sit in front, the rest recede once a scope
 * exists. Hovering the strip unstacks it so every avatar is reachable (the
 * label hides to make room) and lingers 300ms so a pointer crossing to a
 * neighbour does not re-stack it mid-reach. Click toggles, ⌥-click solos,
 * right-click offers Remove project. Built on `ToggleGroup type="multiple"`
 * for the roving focus (←/→, Space); each avatar's hint is the project name.
 */
import { useRef, useState } from 'react';
import type { Project } from '@qlan-ro/mainframe-types';
import { FolderPlus, Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { FadeLabel } from '@/components/ui/fade-label';
import { Hint } from '@/components/ui/hint';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { projectColor } from '@/features/sessions/sidebar/project-color';
import { ProjectAvatar, SCOPE_AVATAR_SIZE } from './ProjectAvatar';

/** Past this many the strip shows "+N" instead of more avatars. */
const MAX_AVATARS = 6;
/** How long the unstacked layout lingers after the pointer leaves. */
const LINGER_MS = 300;

interface ScopeStripProps {
  projects: Project[];
  /** The scoped project ids; empty = all projects. */
  scope: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** ⌥-click: this project alone. */
  onSolo: (id: string) => void;
  onRemoveProject?: (project: Project) => void;
  onAddProject?: () => void;
}

/** Unstacked while hovered, re-stacking only after the linger. */
function useLinger(): { open: boolean; enter: () => void; leave: () => void } {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enter = () => {
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = null;
    setOpen(true);
  };
  const leave = () => {
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), LINGER_MS);
  };
  return { open, enter, leave };
}

function ScopeAvatar({
  project,
  selected,
  dim,
  onSolo,
  onRemove,
}: {
  project: Project;
  selected: boolean;
  dim: boolean;
  onSolo: () => void;
  onRemove?: () => void;
}) {
  const unavailable = project.available === false;
  const item = (
    <ToggleGroupItem
      value={project.id}
      data-testid={`sessions-scope-avatar-${project.id}`}
      aria-label={project.name}
      onClickCapture={(event) => {
        if (!event.altKey) return;
        event.preventDefault();
        event.stopPropagation();
        onSolo();
      }}
      className={cn(
        'h-auto min-w-0 flex-none rounded-full p-0 first:rounded-full last:rounded-full data-[state=on]:bg-transparent',
        selected && 'relative z-10',
      )}
    >
      <ProjectAvatar
        name={project.name}
        color={projectColor(project.id)}
        size={SCOPE_AVATAR_SIZE}
        ring={selected}
        dim={dim || unavailable}
        className="ring-offset-sidebar"
      />
    </ToggleGroupItem>
  );
  const hint = unavailable ? `${project.name} (unavailable)` : project.name;
  if (onRemove == null) return <Hint label={hint}>{item}</Hint>;
  // Hint OUTSIDE the context-menu trigger: a Tooltip root never forwards
  // props to the DOM, so a trigger wrapping the Hint would lose its
  // onContextMenu; the trigger must wrap the real button.
  return (
    <ContextMenu>
      <Hint label={hint}>
        <ContextMenuTrigger asChild>{item}</ContextMenuTrigger>
      </Hint>
      <ContextMenuContent className="w-44">
        <ContextMenuItem data-testid={`sidebar-project-remove-${project.id}`} variant="destructive" onSelect={onRemove}>
          <Trash2Icon />
          Remove project
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function ScopeStrip({ projects, scope, onToggle, onSolo, onRemoveProject, onAddProject }: ScopeStripProps) {
  const linger = useLinger();
  const scoped = projects.filter((p) => scope.has(p.id));
  const shown = projects.slice(0, MAX_AVATARS);
  const overflow = projects.length - shown.length;
  const value = scoped.map((p) => p.id);

  return (
    <div
      data-testid="sessions-scope-strip"
      data-unstacked={linger.open || undefined}
      onPointerEnter={linger.enter}
      onPointerLeave={linger.leave}
      className="flex h-8 min-w-0 items-center gap-2 pl-1"
    >
      <ToggleGroup
        type="multiple"
        value={value}
        onValueChange={(next) => {
          // Radix hands back the whole array; the toggled id is the symmetric difference.
          const changed = projects.find((p) => value.includes(p.id) !== next.includes(p.id));
          if (changed) onToggle(changed.id);
        }}
        className={cn(
          'min-w-0 shrink items-center overflow-x-auto py-0.5 pl-0.5 transition-[gap] [scrollbar-width:none] scroll-fade-x',
          linger.open ? 'gap-[9px]' : '-space-x-1.5',
        )}
      >
        {shown.map((project) => (
          <ScopeAvatar
            key={project.id}
            project={project}
            selected={scope.has(project.id)}
            dim={scope.size > 0 && !scope.has(project.id)}
            onSolo={() => onSolo(project.id)}
            onRemove={onRemoveProject == null ? undefined : () => onRemoveProject(project)}
          />
        ))}
      </ToggleGroup>
      {overflow > 0 && (
        <span data-testid="sessions-scope-more" className="shrink-0 text-xs text-muted-foreground tabular-nums">
          +{overflow}
        </span>
      )}
      {!linger.open && (
        <span data-testid="sessions-scope-label" className="flex min-w-0 flex-1 items-baseline gap-1 text-xs">
          <span className="shrink-0 font-medium text-foreground">
            {scoped.length === 0 ? 'All projects' : `${scoped.length} of ${projects.length}`}
          </span>
          {scoped.length > 0 && (
            <FadeLabel className="flex-1 text-muted-foreground">{scoped.map((p) => p.name).join(', ')}</FadeLabel>
          )}
        </span>
      )}
      {linger.open && <span className="flex-1" />}
      {onAddProject != null && (
        <Hint label="Add project">
          <Button
            variant="ghost"
            size="icon-xs"
            data-testid="sessions-scope-add"
            data-tut="add-project"
            aria-label="Add project"
            className="shrink-0 text-muted-foreground"
            onClick={onAddProject}
          >
            <FolderPlus />
          </Button>
        </Hint>
      )}
    </div>
  );
}
