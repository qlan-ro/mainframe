/**
 * The project's letter, leading every row of the session list (L3) — "–" when
 * the chat has no project. Neutral on purpose: colour in the list is kept for
 * the sessions that need the user, so a project reads by its letter, not its hue.
 *
 * Decorative: the row names the project in text for assistive tech.
 */
import { cn } from '@/lib/utils';

interface SessionProjectTileProps {
  /** Absent for a chat with no project, and while the project list is loading. */
  projectName?: string;
  className?: string;
}

export function SessionProjectTile({ projectName, className }: SessionProjectTileProps) {
  const letter = projectName?.trim().charAt(0).toUpperCase();
  return (
    <span
      aria-hidden
      data-testid="sessions-row-project-tile"
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-[5px] bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)] text-tile font-semibold text-muted-foreground',
        'group-data-active/menu-item:bg-[color-mix(in_srgb,var(--foreground)_12%,transparent)] group-data-active/menu-item:text-sidebar-foreground',
        className,
      )}
    >
      {letter || '–'}
    </span>
  );
}
