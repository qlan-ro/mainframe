/**
 * Build a scope key for launch process statuses.
 * Matches the backend's LaunchRegistry keying: `projectId:effectivePath`.
 */
export function buildLaunchScope(projectId: string, effectivePath: string): string {
  return `${projectId}:${effectivePath}`;
}
