/**
 * WelcomeProjectPicker — a new session's project-or-none trigger, in the strip
 * above the composer (K3): the draft's current choice, or "Choose a project"
 * before anything has resolved, over a menu of the real projects and a trailing
 * "No project" (todo #346). A check marks the choice.
 *
 * Entries are ordered most-recently-active first (see sortProjectsByRecentActivity).
 */
import { ChevronDown, Folder, FolderOpen } from 'lucide-react';
import { useThreadItems } from '@/features/sessions/runtime/use-thread-items';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { listedThreadItemsToSessionItems } from '@/features/sessions/view-model/task-chats';
import { sortProjectsByRecentActivity } from '@/features/sessions/view-model/project-activity';
import { useProjects } from '../use-projects';

export interface WelcomeProjectPickerProps {
  /** undefined = not yet resolved, null = "No project", a string = a project id. */
  projectId: string | null | undefined;
  onSelect: (projectId: string | null) => void;
  /** Controlled, so ⌘; can open it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/** The radio group's value for no project; a project id is never this. */
const NO_PROJECT = '';

function WelcomeProjectTrigger({
  projectId,
  projectName,
}: {
  projectId: string | null | undefined;
  projectName: string | null;
}) {
  if (projectId === undefined) {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-accent-ink">
        <FolderOpen size={14} aria-hidden />
        Choose a project
      </span>
    );
  }
  if (projectId === null) {
    return (
      <>
        <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate">No project</span>
      </>
    );
  }
  return (
    <>
      <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate">{projectName ?? projectId}</span>
    </>
  );
}

export function WelcomeProjectPicker({
  projectId,
  onSelect,
  open,
  onOpenChange,
  className,
}: WelcomeProjectPickerProps) {
  const { projects } = useProjects();
  const threadItems = useThreadItems();
  const sortedProjects = sortProjectsByRecentActivity(projects, listedThreadItemsToSessionItems(threadItems));
  const projectName = projectId == null ? null : (projects.find((p) => p.id === projectId)?.name ?? projectId);
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="welcome-project"
          aria-label={`Project: ${projectId === null ? 'No project' : (projectName ?? 'not chosen')}`}
          className={cn(
            'inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-body text-ink-secondary transition-colors hover:bg-sidebar-accent focus-visible:focus-line',
            className,
          )}
        >
          <WelcomeProjectTrigger projectId={projectId} projectName={projectName} />
          <ChevronDown size={12} className="shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-testid="welcome-project-picker"
        align="start"
        side="top"
        sideOffset={6}
        className="w-auto min-w-60"
      >
        <DropdownMenuLabel>Project</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={projectId === null ? NO_PROJECT : projectId}>
          {sortedProjects.map((project) => (
            <DropdownMenuRadioItem
              key={project.id}
              value={project.id}
              data-testid={`welcome-project-${project.id}`}
              onSelect={() => onSelect(project.id)}
            >
              <Folder aria-hidden />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem
            value={NO_PROJECT}
            data-testid="welcome-project-picker-no-project"
            onSelect={() => onSelect(null)}
          >
            <Folder aria-hidden />
            No project
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
