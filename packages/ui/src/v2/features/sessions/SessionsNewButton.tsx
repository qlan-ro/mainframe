/**
 * The "New session" action, on the first group header.
 *
 * With a project filter active the target is already known and the button opens
 * the draft straight away; in the "All" view it drops a menu to resolve the
 * project first. Both branches run the one `openNewThreadDraft` sequence.
 *
 * Re-clicking retargets the single reused draft rather than stacking a second
 * one, and the menu's open state is lifted so the ⌘N hotkey and the
 * zero-session boot fallback can open this same anchored menu.
 */
import { PlusIcon } from 'lucide-react';
import type { Project } from '@qlan-ro/mainframe-types';
import { Button } from '@v2/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@v2/components/ui/dropdown-menu';
import { projectColor } from '@/features/sessions/sidebar/project-color';
import { useNewSessionPickerTarget } from '@/features/sessions/sidebar/use-new-session-picker-target';
import { ProjectAvatar } from './ProjectAvatar';
import { useOpenDraft } from './use-open-draft';

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

  const label = filterProjectName != null ? `New session in ${filterProjectName}` : 'New session';
  const trigger = (
    <Button
      variant="ghost"
      size="icon-sm"
      data-testid="sessions-new-button"
      aria-label={label}
      title={label}
      className="size-6"
      onClick={filterProjectId != null ? () => pick(filterProjectId) : undefined}
    >
      <PlusIcon />
    </Button>
  );

  if (filterProjectId != null) return trigger;

  return (
    <DropdownMenu open={pickerOpen} onOpenChange={setPickerOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent data-testid="sessions-new-picker" align="end" sideOffset={6} className="w-60">
        <DropdownMenuLabel className="text-muted-foreground">New session in…</DropdownMenuLabel>
        {projects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            data-testid={`sessions-new-picker-project-${project.id}`}
            onSelect={() => pick(project.id)}
          >
            <ProjectAvatar name={project.name} color={projectColor(project.id)} />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{countLabel(sessionCounts[project.id] ?? 0)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
