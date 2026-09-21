/**
 * resolveNewSessionProject — the one target-project resolution every "+" entry
 * point shares (sidebar button, sidebar New Thread row, tab-strip "+", ⌘N): an
 * active project filter pill wins, else the project of the session that was
 * active when the user clicked, else no target — the welcome screen's own
 * picker takes over.
 */
export function resolveNewSessionProject(
  pillProjectId: string | null,
  activeProjectId: string | undefined,
): string | null {
  if (pillProjectId != null) return pillProjectId;
  return activeProjectId ?? null;
}
