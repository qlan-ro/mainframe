import { describe, it, expect } from 'vitest';
import { resolveDefaultTaskProject } from '../resolve-default-project';

describe('resolveDefaultTaskProject', () => {
  it('uses the active session’s project when it is in the set', () => {
    expect(resolveDefaultTaskProject(['proj-1', 'proj-2'], 'proj-2')).toBe('proj-2');
  });

  it('falls back to the first id when the active project is not in the set', () => {
    expect(resolveDefaultTaskProject(['proj-1', 'proj-2'], 'proj-9')).toBe('proj-1');
  });

  it('falls back to the first id when there is no active project', () => {
    expect(resolveDefaultTaskProject(['proj-1', 'proj-2'], null)).toBe('proj-1');
  });

  it('returns null when there are no projects at all', () => {
    expect(resolveDefaultTaskProject([], 'proj-1')).toBeNull();
    expect(resolveDefaultTaskProject([], null)).toBeNull();
  });
});
