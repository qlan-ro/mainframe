/**
 * buildLaunchScope — behavior tests.
 *
 * The scope key joins projectId and effectivePath with a colon.
 * It is the canonical key for process-status and log entries in the sandbox store.
 */
import { it, expect } from 'vitest';
import { buildLaunchScope } from '../launch-scope';

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
