/**
 * The default target project for a NEW task when Tasks has more than one
 * project in scope: the active session's project, if it is one of the
 * candidates, else the first (scope-strip order). Pure and React-free so
 * "New task", the sidebar quick-add chooser, and the create-form's project
 * select all agree on the same default without re-deriving it three times.
 *
 * Returns null only when there is no project at all to target.
 */
export function resolveDefaultTaskProject(
  projectIds: readonly string[],
  activeProjectId: string | null,
): string | null {
  if (activeProjectId != null && projectIds.includes(activeProjectId)) return activeProjectId;
  return projectIds[0] ?? null;
}
