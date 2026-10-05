/**
 * ScopeSummary — the scope strip's two-line label ("N projects" over the faded
 * names). Hovering it lists the projects in scope (every project when the
 * scope is empty) in a tooltip, each with its avatar, since the names line
 * fades long before a multi-project scope fits.
 */
import type { Project } from '@qlan-ro/mainframe-types';
import { FadeLabel } from '@/components/ui/fade-label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { projectColor } from '@/features/sessions/sidebar/project-color';
import { ProjectAvatar } from './ProjectAvatar';

/** Past this many the tooltip ends in "+N more" rather than growing off-screen. */
const MAX_LISTED = 12;
const TOOLTIP_DELAY_MS = 300;

export function scopeTitle(count: number): string {
  if (count === 0) return 'All projects';
  return count === 1 ? '1 project' : `${count} projects`;
}

export function ScopeSummary({ projects, scoped }: { projects: Project[]; scoped: Project[] }) {
  const listed = scoped.length === 0 ? projects : scoped;
  const shown = listed.slice(0, MAX_LISTED);
  const more = listed.length - shown.length;
  return (
    <Tooltip delayDuration={TOOLTIP_DELAY_MS}>
      <TooltipTrigger asChild>
        <div data-testid="sessions-scope-summary" className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
          <span data-testid="sessions-scope-label" className="truncate text-sm font-medium text-foreground">
            {scopeTitle(scoped.length)}
          </span>
          <FadeLabel data-testid="sessions-scope-names" className="text-xs text-muted-foreground">
            {scoped.length === 0 ? `${projects.length} projects` : scoped.map((p) => p.name).join(', ')}
          </FadeLabel>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" data-testid="sessions-scope-tooltip" className="max-w-64">
        <div className="mb-1 font-medium">{scoped.length === 0 ? 'All projects' : 'In scope'}</div>
        <ul className="flex flex-col gap-1">
          {shown.map((project) => (
            <li key={project.id} className="flex min-w-0 items-center gap-1.5">
              <ProjectAvatar name={project.name} color={projectColor(project.id)} size={14} />
              <span className="truncate">{project.name}</span>
            </li>
          ))}
        </ul>
        {more > 0 && <div className="mt-1 opacity-70">+{more} more</div>}
      </TooltipContent>
    </Tooltip>
  );
}
