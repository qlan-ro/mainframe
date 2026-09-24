import { describe, it, expect } from 'vitest';
import type { SessionItem, SessionCustom } from '../chat-to-thread-custom';
import { archivedRowProjectName, filterArchivedSessions } from '../archived-sessions';

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
    temporary: false,
    noProject: false,
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

    const result = filterArchivedSessions(items, new Set());

    expect(result.map((i) => i.id)).toEqual(['a']);
  });

  it('returns all items when every item is archived', () => {
    const items = [
      item('x', 'archived', 'proj-1', BASE_UPDATED_AT + 2),
      item('y', 'archived', 'proj-1', BASE_UPDATED_AT + 1),
    ];

    const result = filterArchivedSessions(items, new Set());

    // Both returned — order tested in the sort section below
    expect(result).toHaveLength(2);
  });

  it('returns [] when no items are archived', () => {
    const items = [item('a', 'regular', 'proj-1', BASE_UPDATED_AT), item('b', 'regular', 'proj-2', BASE_UPDATED_AT)];

    expect(filterArchivedSessions(items, new Set())).toEqual([]);
  });

  it('returns [] for an empty input', () => {
    expect(filterArchivedSessions([], new Set())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// project narrowing when the scope is non-empty
// ---------------------------------------------------------------------------

describe('filterArchivedSessions — narrows by project when the scope is non-empty', () => {
  it('keeps only archived items matching the given projectId', () => {
    const items = [
      item('a', 'archived', 'proj-1', BASE_UPDATED_AT + 3),
      item('b', 'archived', 'proj-2', BASE_UPDATED_AT + 2),
      item('c', 'archived', 'proj-1', BASE_UPDATED_AT + 1),
      item('d', 'regular', 'proj-1', BASE_UPDATED_AT),
    ];

    const result = filterArchivedSessions(items, new Set(['proj-1']));

    expect(result.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('returns [] when the scoped project matches no archived items', () => {
    const items = [item('a', 'archived', 'proj-2', BASE_UPDATED_AT), item('b', 'regular', 'proj-1', BASE_UPDATED_AT)];

    expect(filterArchivedSessions(items, new Set(['proj-1']))).toEqual([]);
  });

  it('keeps archived items from either of two scoped projects', () => {
    const items = [
      item('a', 'archived', 'proj-1', BASE_UPDATED_AT + 3),
      item('b', 'archived', 'proj-2', BASE_UPDATED_AT + 2),
      item('c', 'archived', 'proj-3', BASE_UPDATED_AT + 1),
      item('d', 'regular', 'proj-1', BASE_UPDATED_AT),
    ];

    const result = filterArchivedSessions(items, new Set(['proj-1', 'proj-2']));

    expect(result.map((i) => i.id)).toEqual(['a', 'b']);
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

    const result = filterArchivedSessions(items, new Set());

    expect(result.map((i) => i.id)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('applies the project scope before sorting (proj-1 only, desc)', () => {
    const items = [
      item('p2-late', 'archived', 'proj-2', 900),
      item('p1-early', 'archived', 'proj-1', 100),
      item('p1-late', 'archived', 'proj-1', 800),
    ];

    const result = filterArchivedSessions(items, new Set(['proj-1']));

    expect(result.map((i) => i.id)).toEqual(['p1-late', 'p1-early']);
  });
});

// ---------------------------------------------------------------------------
// a project pill hides non-project chats (todo #346) — needs no dedicated
// code: a no-project chat's projectId never matches a real project id.
// ---------------------------------------------------------------------------

describe('filterArchivedSessions — a project pill hides non-project chats', () => {
  it('excludes a non-project archived chat when a project scope is active', () => {
    const items = [
      item('a', 'archived', 'proj-1', BASE_UPDATED_AT),
      item('np', 'archived', 'mainframe-no-project', BASE_UPDATED_AT, { noProject: true }),
    ];

    const result = filterArchivedSessions(items, new Set(['proj-1']));

    expect(result.map((i) => i.id)).toEqual(['a']);
  });

  it('keeps a non-project archived chat when no project scope is active', () => {
    const items = [item('np', 'archived', 'mainframe-no-project', BASE_UPDATED_AT, { noProject: true })];

    expect(filterArchivedSessions(items, new Set()).map((i) => i.id)).toEqual(['np']);
  });
});

// ---------------------------------------------------------------------------
// archivedRowProjectName — the row's project column (todo #346)
// ---------------------------------------------------------------------------

describe('archivedRowProjectName', () => {
  it('returns "No project" for a chat with no real project, ahead of any name lookup', () => {
    const row = item('np', 'archived', 'mainframe-no-project', BASE_UPDATED_AT, { noProject: true });
    expect(archivedRowProjectName(row, new Map([['mainframe-no-project', 'Should never be read']]))).toBe('No project');
  });

  it("returns the project's resolved name for a project-attached chat", () => {
    const row = item('a', 'archived', 'proj-1', BASE_UPDATED_AT);
    expect(archivedRowProjectName(row, new Map([['proj-1', 'Alpha']]))).toBe('Alpha');
  });

  it('falls back to "Unknown project" for a project id absent from the live list', () => {
    const row = item('a', 'archived', 'proj-removed', BASE_UPDATED_AT);
    expect(archivedRowProjectName(row, new Map())).toBe('Unknown project');
  });
});
