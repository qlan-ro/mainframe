/**
 * WelcomeProjectPicker — the welcome screen's single project-or-none trigger
 * (spec "variant D", todo #346): a dropdown showing the draft's current
 * choice — a colored dot + name, the dashed "No project" glyph, or "Choose a
 * project" before anything has resolved — and a "Start in…" list of every
 * real project plus a trailing "No project" entry at the same row weight.
 *
 * Entries are ordered most-recently-active first (see WelcomeState). The
 * project matching the auto-resolved default (an active filter pill, else the
 * previously-active session — see resolveNewSessionProject) is tagged
 * "Resolved default". That default is frozen the first time this component
 * observes a resolved `projectId` for the CURRENT draft slot, so switching
 * away from it in the picker never moves the tag; a slot that never
 * auto-resolved (the "Choose a project" state) tags nothing.
 */
import { useRef } from 'react';
import { ChevronDown, FolderOpen } from 'lucide-react';
import { useAuiState } from '@assistant-ui/react';
import { ProjectChip } from '@/components/ui/project-chip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NoProjectLabel } from '@/features/sessions/NoProjectLabel';
import { projectColor } from '@/features/sessions/sidebar/project-color';
import { regularThreadItemsToSessionItems } from '@/features/sessions/view-model/chat-to-thread-custom';
import { sortProjectsByRecentActivity } from '@/features/sessions/view-model/project-activity';
import { ProjectAvatar } from '../ProjectAvatar';
import { useProjects } from '../use-projects';

export interface WelcomeProjectPickerProps {
  /** undefined = not yet resolved, null = "No project", a string = a project id. */
  projectId: string | null | undefined;
  onSelect: (projectId: string | null) => void;
}

/**
 * Freezes the first resolved value seen (across this component's mounted
 * lifetime, i.e. one draft slot) as "the default" — a slot that never
 * auto-resolved (started at `undefined`, the "Choose a project" state) never
 * gets one.
 */
function useResolvedDefaultProjectId(projectId: string | null | undefined): string | null | undefined {
  const resolvedRef = useRef<string | null | undefined>(undefined);
  const capturedRef = useRef(false);
  if (!capturedRef.current && projectId !== undefined) {
    resolvedRef.current = projectId;
    capturedRef.current = true;
  }
  return resolvedRef.current;
}

function WelcomeProjectTrigger({
  projectId,
  projectName,
}: {
  projectId: string | null | undefined;
  projectName: string | null;
}) {
  if (projectId === undefined) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
        <FolderOpen size={14} aria-hidden />
        Choose a project
      </span>
    );
  }
  if (projectId === null) return <NoProjectLabel size={14} className="text-sm" />;
  return <ProjectChip projectId={projectId} name={projectName ?? projectId} size={18} />;
}

export function WelcomeProjectPicker({ projectId, onSelect }: WelcomeProjectPickerProps) {
  const { projects } = useProjects();
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const sortedProjects = sortProjectsByRecentActivity(projects, regularThreadItemsToSessionItems(threadItems));
  const projectName = projectId == null ? null : (projects.find((p) => p.id === projectId)?.name ?? projectId);
  const resolvedDefaultId = useResolvedDefaultProjectId(projectId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="welcome-project"
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted"
        >
          <WelcomeProjectTrigger projectId={projectId} projectName={projectName} />
          <ChevronDown size={12} className="text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent data-testid="welcome-project-picker" align="start" sideOffset={6} className="w-60">
        <DropdownMenuLabel className="text-muted-foreground">Start in…</DropdownMenuLabel>
        {sortedProjects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            data-testid={`welcome-project-${project.id}`}
            onSelect={() => onSelect(project.id)}
          >
            <ProjectAvatar name={project.name} color={projectColor(project.id)} />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            {project.id === resolvedDefaultId && (
              <span className="shrink-0 text-xs text-muted-foreground">Resolved default</span>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="welcome-project-picker-no-project" onSelect={() => onSelect(null)}>
          <NoProjectLabel size={14} className="not-italic text-foreground" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
