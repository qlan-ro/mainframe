/**
 * ScopeStrip — the project scope as a row of stacked avatars (replaces the
 * "Scope" dropdown). Scope, not switcher: any number of projects can be in
 * scope and the sessions list shows their union; an empty scope is "All
 * projects". Toggling never activates a session.
 *
 * At rest the avatars stack at a −6px overlap, in-scope projects first with a
 * `primary` ring and a ✓ badge, up to four then a "+N" chip; the rest recede once a scope
 * exists. Beside the stack, two lines: "N projects" (or "All projects") over
 * the faded scoped names. Hovering unstacks EVERY project into a 9px-gap row
 * that scrolls sideways (wheel included), hides the label, keeps the entry
 * order until it re-stacks, and lingers 300ms so a pointer crossing to a
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
const MAX_AVATARS = 4;
/** How long the unstacked layout lingers after the pointer leaves. */
const LINGER_MS = 300;
/** Hover intent before unstacking: a pointer that lands on an avatar and clicks
 *  straight away hits the avatar it aimed at, instead of the row reflowing under it. */
const INTENT_MS = 150;

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

/** Unstacked after a short hover intent, re-stacking only after the linger. */
function useLinger(onOpen: () => void, onRestack: () => void): { open: boolean; enter: () => void; leave: () => void } {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = null;
  };
  const enter = () => {
    clear();
    if (open) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      onOpen();
      setOpen(true);
    }, INTENT_MS);
  };
  const leave = () => {
    clear();
    if (!open) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setOpen(false);
      onRestack();
    }, LINGER_MS);
  };
  return { open, enter, leave };
}

function ScopeAvatar({
  project,
  selected,
  dim,
  stackIndex,
  onSolo,
  onRemove,
}: {
  project: Project;
  selected: boolean;
  dim: boolean;
  /** Earlier avatars sit on top (selected ones come first), like a fanned hand. */
  stackIndex: number;
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
      // The Hint's tooltip trigger overwrites `data-state` ("closed"/"delayed-open"),
      // so neither styling nor tests can key off it; the toggle state lives in
      // `aria-pressed`. The avatar is opaque, so no item background ever shows.
      className="relative h-auto min-w-0 flex-none rounded-full bg-transparent p-0 first:rounded-full last:rounded-full hover:bg-transparent aria-pressed:bg-transparent"
      style={{ zIndex: 100 - stackIndex }}
    >
      <ProjectAvatar
        name={project.name}
        color={projectColor(project.id)}
        size={SCOPE_AVATAR_SIZE}
        ground="--sidebar"
        ring={selected}
        check={selected}
        dim={dim || unavailable}
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

/** In-scope projects first (stable), so a scoped project is never hidden behind "+N". */
function scopeFirst(projects: Project[], scope: ReadonlySet<string>): Project[] {
  return [...projects].sort((a, b) => Number(scope.has(b.id)) - Number(scope.has(a.id)));
}

/** The frozen hover order, with any project added meanwhile appended. */
function applyOrder(projects: Project[], ids: readonly string[]): Project[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const ordered = ids.flatMap((id) => byId.get(id) ?? []);
  return [...ordered, ...projects.filter((p) => !ids.includes(p.id))];
}

/** A vertical wheel scrolls the unstacked strip sideways; a native horizontal one already does. */
function scrollSideways(event: React.WheelEvent<HTMLDivElement>) {
  const el = event.currentTarget;
  if (el.scrollWidth <= el.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  el.scrollLeft += event.deltaY;
}

function scopeTitle(count: number): string {
  if (count === 0) return 'All projects';
  return count === 1 ? '1 project' : `${count} projects`;
}

export function ScopeStrip({ projects, scope, onToggle, onSolo, onRemoveProject, onAddProject }: ScopeStripProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  // The hover order is captured on entry and held until the strip re-stacks, so
  // toggling an avatar never re-sorts the row out from under the pointer.
  const [frozen, setFrozen] = useState<readonly string[] | null>(null);
  const restOrder = scopeFirst(projects, scope);
  const linger = useLinger(
    () => setFrozen(restOrder.map((p) => p.id)),
    () => {
      setFrozen(null);
      scrollerRef.current?.scrollTo({ left: 0 });
    },
  );
  const ordered = frozen == null ? restOrder : applyOrder(projects, frozen);
  const scoped = projects.filter((p) => scope.has(p.id));
  // At rest: up to four, then "+N". Unstacked: every project, scrollable.
  const shown = linger.open ? ordered : ordered.slice(0, MAX_AVATARS);
  const overflow = projects.length - shown.length;
  const value = scoped.map((p) => p.id);

  return (
    <div
      data-testid="sessions-scope-strip"
      data-unstacked={linger.open || undefined}
      onPointerEnter={linger.enter}
      onPointerLeave={linger.leave}
      className="flex min-h-10 min-w-0 items-center gap-2"
    >
      {/* The scroller pads by 4px all round: the selected halo (2px) and the ✓ badge
          draw outside the avatar and an overflow container would clip them. */}
      <div
        ref={scrollerRef}
        onWheel={scrollSideways}
        className="flex min-w-0 shrink items-center overflow-x-auto p-1 [scrollbar-width:none] scroll-fade-x"
      >
        <ToggleGroup
          type="multiple"
          value={value}
          onValueChange={(next) => {
            // Radix hands back the whole array; the toggled id is the symmetric difference.
            const changed = projects.find((p) => value.includes(p.id) !== next.includes(p.id));
            if (changed) onToggle(changed.id);
          }}
          className={cn('items-center transition-[gap]', linger.open ? 'gap-[9px]' : '-space-x-1.5')}
        >
          {shown.map((project, index) => (
            <ScopeAvatar
              key={project.id}
              project={project}
              stackIndex={index}
              selected={scope.has(project.id)}
              dim={scope.size > 0 && !scope.has(project.id)}
              onSolo={() => onSolo(project.id)}
              onRemove={onRemoveProject == null ? undefined : () => onRemoveProject(project)}
            />
          ))}
        </ToggleGroup>
        {overflow > 0 && (
          <span
            data-testid="sessions-scope-more"
            className="relative -ml-1.5 inline-flex shrink-0 items-center justify-center rounded-full px-1 text-xs font-semibold text-muted-foreground tabular-nums"
            style={{
              minWidth: SCOPE_AVATAR_SIZE,
              height: SCOPE_AVATAR_SIZE,
              // Same cut-out as the avatars, on an opaque neutral disc.
              backgroundColor: 'color-mix(in oklch, var(--foreground) 10%, var(--sidebar))',
              border: '2px solid var(--sidebar)',
            }}
          >
            +{overflow}
          </span>
        )}
      </div>
      {!linger.open && (
        <div className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
          <span data-testid="sessions-scope-label" className="truncate text-sm font-medium text-foreground">
            {scopeTitle(scoped.length)}
          </span>
          <FadeLabel data-testid="sessions-scope-names" className="text-xs text-muted-foreground">
            {scoped.length === 0 ? `${projects.length} projects` : scoped.map((p) => p.name).join(', ')}
          </FadeLabel>
        </div>
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
