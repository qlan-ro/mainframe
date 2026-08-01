/**
 * The "New session" action row, directly under the Sessions section label.
 *
 * With a project filter active the target is already known and the row opens
 * the draft straight away; in the "All" view it drops a menu to resolve the
 * project first. Both branches run the one `openNewThreadDraft` sequence.
 *
 * Re-clicking retargets the single reused draft rather than stacking a second
 * one, and the menu's open state is lifted so the ⌘N hotkey and the
 * zero-session boot fallback can open this same anchored menu.
 */
import { PlusIcon } from 'lucide-react';
import type { Project } from '@qlan-ro/mainframe-types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@v2/components/ui/dropdown-menu';
import { SidebarMenuButton, SidebarMenuItem } from '@v2/components/ui/sidebar';
import { projectColor } from '@/features/sessions/sidebar/project-color';
import { useNewSessionPickerTarget } from '@/features/sessions/sidebar/use-new-session-picker-target';
import { ProjectAvatar } from './ProjectAvatar';
import { useOpenDraft } from './use-open-draft';

/** Level 1 — the row lines up with the time-group labels below it. */
const ROW_INDENT = 'pl-5';

function countLabel(count: number): string {
  if (count <= 0) return 'no sessions';
  return `${count} session${count === 1 ? '' : 's'}`;
}

interface SessionsNewButtonProps {
  filterProjectId: string | null;
  filterProjectName: string | null;
  projects: Project[];
  /** Project id → session count, shown next to each menu entry. */
  sessionCounts: Record<string, number>;
}

export function SessionsNewButton({
  filterProjectId,
  filterProjectName,
  projects,
  sessionCounts,
}: SessionsNewButtonProps) {
  const pickerOpen = useNewSessionPickerTarget((s) => s.open);
  const setPickerOpen = useNewSessionPickerTarget((s) => s.setOpen);
  const openDraft = useOpenDraft();

  const pick = (projectId: string) => {
    void openDraft({ projectId });
  };

  if (filterProjectId != null) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          data-testid="sessions-new-button"
          size="sm"
          className={`${ROW_INDENT} text-muted-foreground`}
          onClick={() => pick(filterProjectId)}
        >
          <PlusIcon />
          <span className="truncate">New session{filterProjectName != null ? ` in ${filterProjectName}` : ''}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <DropdownMenu open={pickerOpen} onOpenChange={setPickerOpen}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            data-testid="sessions-new-button"
            size="sm"
            className={`${ROW_INDENT} text-muted-foreground`}
          >
            <PlusIcon />
            <span className="truncate">New session</span>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent data-testid="sessions-new-picker" align="start" className="w-60">
          <DropdownMenuLabel className="text-muted-foreground">New session in…</DropdownMenuLabel>
          {projects.map((project) => (
            <DropdownMenuItem
              key={project.id}
              data-testid={`sessions-new-picker-project-${project.id}`}
              onSelect={() => pick(project.id)}
            >
              <ProjectAvatar name={project.name} color={projectColor(project.id)} />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {countLabel(sessionCounts[project.id] ?? 0)}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
