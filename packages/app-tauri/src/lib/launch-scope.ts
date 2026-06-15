/**
 * Scope key for launch process statuses and log entries.
 *
 * Matches the daemon LaunchRegistry keying convention so that WS event
 * scope keys round-trip correctly with what the REST status endpoint returns.
 */
export function buildLaunchScope(projectId: string, effectivePath: string): string {
  return `${projectId}:${effectivePath}`;
}
