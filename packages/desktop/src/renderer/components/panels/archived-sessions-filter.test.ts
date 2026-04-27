import { describe, it, expect } from 'vitest';
import type { Chat } from '@qlan-ro/mainframe-types';
import { filterArchivedChats } from './archived-sessions-filter';

function makeChat(overrides: Partial<Chat> & Pick<Chat, 'id' | 'projectId' | 'status'>): Chat {
  return {
    adapterId: 'claude',
    createdAt: '2026-04-21T00:00:00Z',
    updatedAt: '2026-04-21T00:00:00Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    ...overrides,
  };
}

describe('filterArchivedChats', () => {
  it('keeps only chats with status "archived"', () => {
    const chats = [
      makeChat({ id: 'a', projectId: 'p1', status: 'archived' }),
      makeChat({ id: 'b', projectId: 'p1', status: 'active' }),
      makeChat({ id: 'c', projectId: 'p1', status: 'archived' }),
    ];
    const result = filterArchivedChats(chats, null);
    expect(result.map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('when projectId filter is null, includes archived chats from all projects', () => {
    const chats = [
      makeChat({ id: 'a', projectId: 'p1', status: 'archived' }),
      makeChat({ id: 'b', projectId: 'p2', status: 'archived' }),
    ];
    const result = filterArchivedChats(chats, null);
    expect(new Set(result.map((c) => c.projectId))).toEqual(new Set(['p1', 'p2']));
  });

  it('when projectId filter is set, restricts to that project', () => {
    const chats = [
      makeChat({ id: 'a', projectId: 'p1', status: 'archived' }),
      makeChat({ id: 'b', projectId: 'p2', status: 'archived' }),
      makeChat({ id: 'c', projectId: 'p1', status: 'archived' }),
    ];
    const result = filterArchivedChats(chats, 'p1');
    expect(result.map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('sorts results by updatedAt descending (most recent first)', () => {
    const chats = [
      makeChat({ id: 'old', projectId: 'p1', status: 'archived', updatedAt: '2026-01-01T00:00:00Z' }),
      makeChat({ id: 'new', projectId: 'p1', status: 'archived', updatedAt: '2026-04-01T00:00:00Z' }),
      makeChat({ id: 'mid', projectId: 'p1', status: 'archived', updatedAt: '2026-02-15T00:00:00Z' }),
    ];
    const result = filterArchivedChats(chats, null);
    expect(result.map((c) => c.id)).toEqual(['new', 'mid', 'old']);
  });

  it('returns an empty array when no chats are archived', () => {
    const chats = [
      makeChat({ id: 'a', projectId: 'p1', status: 'active' }),
      makeChat({ id: 'b', projectId: 'p1', status: 'active' }),
    ];
    expect(filterArchivedChats(chats, null)).toEqual([]);
  });
});
