/**
 * The rule a modal uses to pick the project it opens on.
 *
 * Order: the sidebar filter, the active session's project, the sole project,
 * then nothing. Both ids are validated against the live project list — a filter
 * or a session pointing at a deleted project would otherwise scope a modal to a
 * project the user cannot see or switch away from.
 *
 * Pure and React-free so both modals seed identically and the rule is testable
 * on its own.
 */

export interface SeedProjectScopeInput {
  /** The sidebar's persisted project filter. Null means "All projects". */
  filterProjectId: string | null;
  /** The active session's project, draft-aware, or null when none resolves. */
  sessionProjectId: string | null;
  projects: readonly { id: string }[];
}

export function seedProjectScope({
  filterProjectId,
  sessionProjectId,
  projects,
}: SeedProjectScopeInput): string | null {
  const known = (id: string | null): string | null =>
    id !== null && projects.some((project) => project.id === id) ? id : null;

  const sole = projects.length === 1 ? projects[0] : undefined;
  return known(filterProjectId) ?? known(sessionProjectId) ?? sole?.id ?? null;
}
