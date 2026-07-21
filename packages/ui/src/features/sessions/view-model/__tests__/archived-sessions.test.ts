import { describe, it, expect } from 'vitest';
import type { SessionItem, SessionCustom } from '../chat-to-thread-custom';
import { filterArchivedSessions } from '../archived-sessions';

// ---------------------------------------------------------------------------
// Fixture helpers — mirror group-sessions.test.ts style
// ---------------------------------------------------------------------------

const BASE_UPDATED_AT = 1_000_000; // arbitrary baseline ms

function item(
  id: string,
  status: 'regular' | 'archived',
  projectId: string,
  updatedAt: number,
  overrides?: Partial<SessionCustom>,
): SessionItem {
  const custom: SessionCustom = {
    projectId,
    adapterId: 'claude',
    tags: [],
    pinned: false,
    status: status === 'archived' ? 'archived' : 'active',
    displayStatus: 'idle',
    hasPending: false,
    detectedPrs: [],
    worktreeMissing: false,
    transcriptMissing: false,
    updatedAt,
    ...overrides,
  };
  return { id, title: `Session ${id}`, status, custom };
}

// ---------------------------------------------------------------------------
// keeps only archived items
// ---------------------------------------------------------------------------

describe('filterArchivedSessions — keeps only items with status === "archived"', () => {
  it('returns only the archived item from a mixed list', () => {
    const items = [
      item('a', 'archived', 'proj-1', BASE_UPDATED_AT),
      item('b', 'regular', 'proj-1', BASE_UPDATED_AT),
      item('c', 'regular', 'proj-1', BASE_UPDATED_AT),
    ];

    const result = filterArchivedSessions(items, null);

    expect(result.map((i) => i.id)).toEqual(['a']);
  });

  it('returns all items when every item is archived', () => {
    const items = [
      item('x', 'archived', 'proj-1', BASE_UPDATED_AT + 2),
      item('y', 'archived', 'proj-1', BASE_UPDATED_AT + 1),
    ];

    const result = filterArchivedSessions(items, null);

    // Both returned — order tested in the sort section below
    expect(result).toHaveLength(2);
  });

  it('returns [] when no items are archived', () => {
    const items = [item('a', 'regular', 'proj-1', BASE_UPDATED_AT), item('b', 'regular', 'proj-2', BASE_UPDATED_AT)];

    expect(filterArchivedSessions(items, null)).toEqual([]);
  });

  it('returns [] for an empty input', () => {
    expect(filterArchivedSessions([], null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// project narrowing when filterProjectId is provided
// ---------------------------------------------------------------------------

describe('filterArchivedSessions — narrows by projectId when filterProjectId is not null', () => {
  it('keeps only archived items matching the given projectId', () => {
    const items = [
      item('a', 'archived', 'proj-1', BASE_UPDATED_AT + 3),
      item('b', 'archived', 'proj-2', BASE_UPDATED_AT + 2),
      item('c', 'archived', 'proj-1', BASE_UPDATED_AT + 1),
      item('d', 'regular', 'proj-1', BASE_UPDATED_AT),
    ];

    const result = filterArchivedSessions(items, 'proj-1');

    expect(result.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('returns [] when the projectId matches no archived items', () => {
    const items = [item('a', 'archived', 'proj-2', BASE_UPDATED_AT), item('b', 'regular', 'proj-1', BASE_UPDATED_AT)];

    expect(filterArchivedSessions(items, 'proj-1')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// sort order — descending by updatedAt (most recently touched first)
// ---------------------------------------------------------------------------

describe('filterArchivedSessions — sorts by custom.updatedAt descending', () => {
  it('returns [newest, middle, oldest] for three archived items in arbitrary input order', () => {
    const items = [
      item('oldest', 'archived', 'proj-1', 100),
      item('newest', 'archived', 'proj-1', 300),
      item('middle', 'archived', 'proj-1', 200),
    ];

    const result = filterArchivedSessions(items, null);

    expect(result.map((i) => i.id)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('applies project filter before sorting (proj-1 only, desc)', () => {
    const items = [
      item('p2-late', 'archived', 'proj-2', 900),
      item('p1-early', 'archived', 'proj-1', 100),
      item('p1-late', 'archived', 'proj-1', 800),
    ];

    const result = filterArchivedSessions(items, 'proj-1');

    expect(result.map((i) => i.id)).toEqual(['p1-late', 'p1-early']);
  });
});
