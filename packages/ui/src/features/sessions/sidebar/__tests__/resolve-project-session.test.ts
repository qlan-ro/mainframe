import { describe, it, expect } from 'vitest';
import { resolveProjectSession } from '../resolve-project-session';

const item = (id: string, projectId: string, updatedAt: number, status: 'regular' | 'archived' = 'regular') =>
  ({ id, remoteId: id, status, custom: { projectId, updatedAt } }) as any;

describe('resolveProjectSession', () => {
  const items = [item('a', 'p1', 100), item('b', 'p1', 300), item('c', 'p2', 200)];

  it('returns the remembered session when it is live in the project', () => {
    expect(resolveProjectSession(items, 'p1', { p1: 'a' })).toBe('a');
  });
  it('falls back to most-recent-by-time when the remembered one is missing/archived', () => {
    expect(resolveProjectSession(items, 'p1', { p1: 'gone' })).toBe('b'); // b has the highest updatedAt in p1
  });
  it('falls back to most-recent when there is no remembered session', () => {
    expect(resolveProjectSession(items, 'p1', {})).toBe('b');
  });
  it('returns null when the project has no sessions', () => {
    expect(resolveProjectSession(items, 'pX', {})).toBeNull();
  });
  it('falls back to most-recent live when the remembered session is archived', () => {
    const withArchived = [item('a', 'p1', 500, 'archived'), item('b', 'p1', 300), item('c', 'p2', 200)];
    // remembered 'a' is archived → excluded from live set → falls back to 'b' (highest updatedAt among live p1 sessions)
    expect(resolveProjectSession(withArchived, 'p1', { p1: 'a' })).toBe('b');
  });
});
