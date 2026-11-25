import { ChevronDown, FolderOpen } from 'lucide-react';
import { useThreadItems } from '@/features/sessions/runtime/use-thread-items';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
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
  const label = projectId === null ? 'No project' : (projectName ?? 'Choose a project');

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="welcome-project"
              aria-label={`Project: ${projectId === null ? 'No project' : (projectName ?? 'not chosen')}`}
              className={cn(
                'inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted focus-visible:focus-line',
                className,
              )}
            >
              <FolderOpen size={14} className="shrink-0" aria-hidden />
              <span className="truncate" title={label}>
                {label}
              </span>
              <ChevronDown size={12} className="shrink-0 text-muted-foreground" aria-hidden />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Select project ⌘;</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        data-testid="welcome-project-picker"
        align="start"
        sideOffset={6}
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-60 overflow-y-auto"
      >
        <DropdownMenuLabel className="text-muted-foreground">Project</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={projectId === null ? 'none' : projectId}
          onValueChange={(id) => onSelect(id === 'none' ? null : id)}
        >
          {sortedProjects.map((project) => (
            <DropdownMenuRadioItem
              key={project.id}
              value={project.id}
              data-testid={`welcome-project-${project.id}`}
              aria-label={project.name}
            >
              <FolderOpen size={14} className="shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate" title={project.name}>
                {project.name}
              </span>
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value="none" data-testid="welcome-project-picker-no-project">
            No project
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
