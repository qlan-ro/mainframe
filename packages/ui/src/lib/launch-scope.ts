/**
 * Scope key for launch process statuses and log entries.
 *
 * Matches the daemon LaunchRegistry keying convention so that WS event
 * scope keys round-trip correctly with what the REST status endpoint returns.
 */
export function buildLaunchScope(projectId: string, effectivePath: string): string {
  return `${projectId}:${effectivePath}`;
}

/**
 * The active session's launch scope, or `null` when it can't be resolved yet
 * (no project, or paths not loaded). `effectivePath = worktreePath ?? projectPath`
 * mirrors the daemon's `getEffectivePath`, so this matches the scope every run
 * tab captures at creation — the single source of truth for both stamping a new
 * tab's scope and filtering which tabs the Run surface shows.
 */
export function activeLaunchScope(
  projectId: string | undefined,
  worktreePath: string | undefined,
  projectPath: string | undefined,
): string | null {
  const effectivePath = worktreePath ?? projectPath;
  return projectId && effectivePath ? buildLaunchScope(projectId, effectivePath) : null;
}
