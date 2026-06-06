import { describe, it, expect } from 'vitest';
import type { Project } from '@qlan-ro/mainframe-types';
import type { SessionItem, SessionCustom } from '../chat-to-thread-custom';
import { groupSessions } from '../group-sessions';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function item(id: string, projectId: string, overrides: Partial<SessionCustom> = {}): SessionItem {
  return {
    id,
    status: 'regular',
    custom: {
      projectId,
      adapterId: 'claude',
      tags: [],
      pinned: false,
      status: 'active',
      displayStatus: 'idle',
      hasPending: false,
      detectedPrs: [],
      worktreeMissing: false,
      updatedAt: 1000,
      ...overrides,
    },
  };
}

const PROJECTS: Project[] = [
  { id: 'proj-a', name: 'Alpha', path: '/a', createdAt: '', lastOpenedAt: '' },
  { id: 'proj-b', name: 'Beta', path: '/b', createdAt: '', lastOpenedAt: '' },
];

// ---------------------------------------------------------------------------
// groupSessions — groups by projectId
// ---------------------------------------------------------------------------

describe('groupSessions — groups by projectId', () => {
  it('returns two groups when items span two projects', () => {
    const items = [
      item('s1', 'proj-a', { updatedAt: 1000 }),
      item('s2', 'proj-b', { updatedAt: 1000 }),
      item('s3', 'proj-a', { updatedAt: 1000 }),
    ];
    const groups = groupSessions(items, { filterProjectId: null, projects: PROJECTS });
    expect(groups).toHaveLength(2);
  });

  it('group proj-a has 2 items with ids s1 and s3, and projectName Alpha', () => {
    const items = [
      item('s1', 'proj-a', { updatedAt: 1000 }),
      item('s2', 'proj-b', { updatedAt: 1000 }),
      item('s3', 'proj-a', { updatedAt: 1000 }),
    ];
    const groups = groupSessions(items, { filterProjectId: null, projects: PROJECTS });
    const groupA = groups.find((g) => g.projectId === 'proj-a');
    expect(groupA).toBeDefined();
    expect(groupA!.projectName).toBe('Alpha');
    expect(groupA!.items).toHaveLength(2);
    const ids = groupA!.items.map((i) => i.id);
    expect(ids).toContain('s1');
    expect(ids).toContain('s3');
  });

  it('group proj-b has 1 item with id s2 and projectName Beta', () => {
    const items = [
      item('s1', 'proj-a', { updatedAt: 1000 }),
      item('s2', 'proj-b', { updatedAt: 1000 }),
      item('s3', 'proj-a', { updatedAt: 1000 }),
    ];
    const groups = groupSessions(items, { filterProjectId: null, projects: PROJECTS });
    const groupB = groups.find((g) => g.projectId === 'proj-b');
    expect(groupB).toBeDefined();
    expect(groupB!.projectName).toBe('Beta');
    expect(groupB!.items).toHaveLength(1);
    expect(groupB!.items[0]?.id).toBe('s2');
  });
});

// ---------------------------------------------------------------------------
// groupSessions — unknown project name fallback
// ---------------------------------------------------------------------------

describe('groupSessions — unknown project name fallback', () => {
  it('falls back to the projectId string when no matching project exists', () => {
    const items = [item('s1', 'proj-unknown', { updatedAt: 1000 })];
    const groups = groupSessions(items, { filterProjectId: null, projects: PROJECTS });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.projectName).toBe('proj-unknown');
  });
});

// ---------------------------------------------------------------------------
// groupSessions — pinned-first within a group
// ---------------------------------------------------------------------------

describe('groupSessions — pinned-first within a group', () => {
  it('orders pinned item first, then non-pinned by updatedAt desc', () => {
    const items = [
      item('s1', 'proj-a', { updatedAt: 2000, pinned: false }),
      item('s2', 'proj-a', { updatedAt: 1000, pinned: true }),
      item('s3', 'proj-a', { updatedAt: 3000, pinned: false }),
    ];
    const groups = groupSessions(items, { filterProjectId: null, projects: PROJECTS });
    const groupA = groups.find((g) => g.projectId === 'proj-a');
    expect(groupA).toBeDefined();
    expect(groupA!.items.map((i) => i.id)).toEqual(['s2', 's3', 's1']);
  });
});

// ---------------------------------------------------------------------------
// groupSessions — within pinned tier, sort by updatedAt desc
// ---------------------------------------------------------------------------

describe('groupSessions — within pinned tier, sort by updatedAt desc', () => {
  it('sorts two pinned items by updatedAt desc: s2 (1500) before s1 (500)', () => {
    const items = [
      item('s1', 'proj-a', { updatedAt: 500, pinned: true }),
      item('s2', 'proj-a', { updatedAt: 1500, pinned: true }),
    ];
    const groups = groupSessions(items, { filterProjectId: null, projects: PROJECTS });
    const groupA = groups.find((g) => g.projectId === 'proj-a');
    expect(groupA).toBeDefined();
    expect(groupA!.items.map((i) => i.id)).toEqual(['s2', 's1']);
  });
});

// ---------------------------------------------------------------------------
// groupSessions — filterProjectId set → flat single group
// ---------------------------------------------------------------------------

describe('groupSessions — filterProjectId set', () => {
  it('returns exactly one group containing only proj-a items', () => {
    const items = [
      item('s1', 'proj-a', { updatedAt: 1000 }),
      item('s2', 'proj-b', { updatedAt: 1000 }),
      item('s3', 'proj-a', { updatedAt: 1000 }),
    ];
    const groups = groupSessions(items, { filterProjectId: 'proj-a', projects: PROJECTS });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.projectId).toBe('proj-a');
    expect(groups[0]?.projectName).toBe('Alpha');
    expect(groups[0]?.items).toHaveLength(2);
    const ids = groups[0]!.items.map((i) => i.id);
    expect(ids).toContain('s1');
    expect(ids).toContain('s3');
    expect(ids).not.toContain('s2');
  });
});

// ---------------------------------------------------------------------------
// groupSessions — count equals items length
// ---------------------------------------------------------------------------

describe('groupSessions — count equals items length', () => {
  it('group proj-a count is 2 for two proj-a items', () => {
    const items = [
      item('s1', 'proj-a', { updatedAt: 1000 }),
      item('s2', 'proj-b', { updatedAt: 1000 }),
      item('s3', 'proj-a', { updatedAt: 1000 }),
    ];
    const groups = groupSessions(items, { filterProjectId: null, projects: PROJECTS });
    const groupA = groups.find((g) => g.projectId === 'proj-a');
    expect(groupA!.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// groupSessions — empty items list
// ---------------------------------------------------------------------------

describe('groupSessions — empty items list', () => {
  it('returns an empty array', () => {
    expect(groupSessions([], { filterProjectId: null, projects: PROJECTS })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// groupSessions — stable order across equal updatedAt
// ---------------------------------------------------------------------------

describe('groupSessions — stable order across equal updatedAt', () => {
  it('neither item is dropped when both have the same updatedAt', () => {
    const items = [item('s1', 'proj-a', { updatedAt: 1000 }), item('s2', 'proj-a', { updatedAt: 1000 })];
    const groups = groupSessions(items, { filterProjectId: null, projects: PROJECTS });
    const groupA = groups.find((g) => g.projectId === 'proj-a');
    expect(groupA!.items).toHaveLength(2);
  });

  it('produces the same id order when called twice on the same items reference', () => {
    const items = [item('s1', 'proj-a', { updatedAt: 1000 }), item('s2', 'proj-a', { updatedAt: 1000 })];
    const opts = { filterProjectId: null as null, projects: PROJECTS };
    const first = groupSessions(items, opts)
      .find((g) => g.projectId === 'proj-a')!
      .items.map((i) => i.id);
    const second = groupSessions(items, opts)
      .find((g) => g.projectId === 'proj-a')!
      .items.map((i) => i.id);
    expect(first).toEqual(second);
  });
});
