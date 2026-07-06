/**
 * buildLaunchScope — behavior tests.
 *
 * The scope key joins projectId and effectivePath with a colon.
 * It is the canonical key for process-status and log entries in the sandbox store.
 */
import { it, expect, describe } from 'vitest';
import { buildLaunchScope, activeLaunchScope } from '../launch-scope';

it('joins projectId and effectivePath with a colon', () => {
  expect(buildLaunchScope('proj-1', '/Users/x/repo')).toBe('proj-1:/Users/x/repo');
});

it('works with empty effectivePath', () => {
  expect(buildLaunchScope('proj-2', '')).toBe('proj-2:');
});

it('works with paths that contain colons', () => {
  // Windows-style paths could contain colons; the separator is always the first colon
  expect(buildLaunchScope('proj-3', 'C:/Users/x')).toBe('proj-3:C:/Users/x');
});

// ---------------------------------------------------------------------------
// activeLaunchScope — resolves to worktreePath when present, projectPath as
// fallback, and null when either projectId or the effective path is missing.
// ---------------------------------------------------------------------------
describe('activeLaunchScope', () => {
  it('uses worktreePath (over projectPath) when both are provided', () => {
    expect(activeLaunchScope('proj-1', '/wt', '/proj')).toBe('proj-1:/wt');
  });

  it('falls back to projectPath when worktreePath is undefined', () => {
    expect(activeLaunchScope('proj-1', undefined, '/proj')).toBe('proj-1:/proj');
  });

  it('returns null when projectId is undefined', () => {
    expect(activeLaunchScope(undefined, '/wt', '/proj')).toBeNull();
  });

  it('returns null when both worktreePath and projectPath are undefined', () => {
    expect(activeLaunchScope('proj-1', undefined, undefined)).toBeNull();
  });
});
