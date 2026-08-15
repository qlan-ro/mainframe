import { describe, it, expect } from 'vitest';
import type { SessionItem, SessionCustom } from '../chat-to-thread-custom';
import { arrangeSessions, SESSION_SORTS } from '../group-sessions';
import type { SortMode, SessionGroupResult } from '../group-sessions';

// ---------------------------------------------------------------------------
// Fixed reference clock — 2026-06-07T12:00:00 local time.
// All buckets are computed relative to this fixed `now` (passed explicitly so
// the view-model stays pure and the assertions are deterministic).
// ---------------------------------------------------------------------------

const NOW = new Date(2026, 5, 7, 12, 0, 0).getTime(); // Sun Jun 7 2026 12:00 local
const TODAY_0900 = new Date(2026, 5, 7, 9, 0, 0).getTime();
const TODAY_1100 = new Date(2026, 5, 7, 11, 0, 0).getTime();
const YESTERDAY_1000 = new Date(2026, 5, 6, 10, 0, 0).getTime();
const EARLIER_MON = new Date(2026, 5, 1, 8, 0, 0).getTime();

function item(id: string, overrides: Partial<SessionCustom> & { title?: string } = {}): SessionItem {
  const { title, ...custom } = overrides;
  return {
    id,
    title: title ?? `Session ${id}`,
    status: 'regular',
    custom: {
      projectId: 'proj-a',
      adapterId: 'claude',
      tags: [],
      pinned: false,
      status: 'active',
      displayStatus: 'idle',
      hasPending: false,
      detectedPrs: [],
      worktreeMissing: false,
      transcriptMissing: false,
      updatedAt: TODAY_1100,
      ...custom,
    },
  };
}

function labels(groups: { label: string }[]): string[] {
  return groups.map((g) => g.label);
}

function idsOf(groups: { label: string; items: SessionItem[] }[], label: string): string[] {
  return (groups.find((g) => g.label === label)?.items ?? []).map((i) => i.id);
}

// ---------------------------------------------------------------------------
// SESSION_SORTS — the menu options
// ---------------------------------------------------------------------------

describe('SESSION_SORTS', () => {
  it('exposes recent / name / status / project options in order', () => {
    expect(SESSION_SORTS.map((s) => s.id)).toEqual(['recent', 'name', 'status', 'project']);
  });

  it('labels each option', () => {
    expect(SESSION_SORTS.map((s) => s.label)).toEqual(['Recent activity', 'Name (A–Z)', 'Status', 'Project']);
  });
});

// ---------------------------------------------------------------------------
// mode 'recent' — Pinned + time buckets (Today / Yesterday / Earlier)
// ---------------------------------------------------------------------------

describe("arrangeSessions mode 'recent'", () => {
  it('emits exactly Pinned, Today, Yesterday, Earlier (non-empty, in order)', () => {
    const items = [
      item('pin1', { pinned: true, updatedAt: EARLIER_MON }),
      item('today1', { updatedAt: TODAY_1100 }),
      item('yest1', { updatedAt: YESTERDAY_1000 }),
      item('old1', { updatedAt: EARLIER_MON }),
    ];
    const groups = arrangeSessions(items, 'recent', NOW);
    expect(labels(groups)).toEqual(['Pinned', 'Today', 'Yesterday', 'Earlier']);
  });

  it('excludes pinned items from the time buckets', () => {
    const items = [item('pin1', { pinned: true, updatedAt: TODAY_1100 }), item('today1', { updatedAt: TODAY_1100 })];
    const groups = arrangeSessions(items, 'recent', NOW);
    expect(idsOf(groups, 'Pinned')).toEqual(['pin1']);
    expect(idsOf(groups, 'Today')).toEqual(['today1']);
  });

  it('orders within the Today bucket by updatedAt desc', () => {
    const items = [item('early', { updatedAt: TODAY_0900 }), item('late', { updatedAt: TODAY_1100 })];
    const groups = arrangeSessions(items, 'recent', NOW);
    expect(idsOf(groups, 'Today')).toEqual(['late', 'early']);
  });

  it('omits the Pinned group when there are no pinned items', () => {
    const items = [item('today1', { updatedAt: TODAY_1100 })];
    const groups = arrangeSessions(items, 'recent', NOW);
    expect(labels(groups)).toEqual(['Today']);
  });

  it('omits empty time buckets', () => {
    const items = [item('old1', { updatedAt: EARLIER_MON })];
    const groups = arrangeSessions(items, 'recent', NOW);
    expect(labels(groups)).toEqual(['Earlier']);
  });

  it('returns an empty array for no items', () => {
    expect(arrangeSessions([], 'recent', NOW)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mode 'name' — Pinned + a single A–Z group
// ---------------------------------------------------------------------------

describe("arrangeSessions mode 'name'", () => {
  it('emits Pinned then A–Z, with rest alphabetised by title', () => {
    const items = [
      item('p', { pinned: true, title: 'Zeta pinned' }),
      item('c', { title: 'Charlie' }),
      item('a', { title: 'Alpha' }),
      item('b', { title: 'Bravo' }),
    ];
    const groups = arrangeSessions(items, 'name', NOW);
    expect(labels(groups)).toEqual(['Pinned', 'A–Z']);
    expect(idsOf(groups, 'A–Z')).toEqual(['a', 'b', 'c']);
  });

  it('omits the Pinned group when no items are pinned', () => {
    const items = [item('b', { title: 'Bravo' }), item('a', { title: 'Alpha' })];
    const groups = arrangeSessions(items, 'name', NOW);
    expect(labels(groups)).toEqual(['A–Z']);
    expect(idsOf(groups, 'A–Z')).toEqual(['a', 'b']);
  });

  it('resolves identical titles by updatedAt descending while distinct titles stay alphabetical', () => {
    const items = [
      item('c', { title: 'Charlie' }),
      item('a-old', { title: 'Alpha', updatedAt: EARLIER_MON }),
      item('a-new', { title: 'Alpha', updatedAt: TODAY_1100 }),
    ];
    const groups = arrangeSessions(items, 'name', NOW);
    expect(idsOf(groups, 'A–Z')).toEqual(['a-new', 'a-old', 'c']);
  });

  it('orders a multi-session Pinned group by recency in name mode', () => {
    const items = [
      item('p-old', { pinned: true, updatedAt: EARLIER_MON, title: 'B' }),
      item('p-new', { pinned: true, updatedAt: TODAY_1100, title: 'A' }),
    ];
    const groups = arrangeSessions(items, 'name', NOW);
    expect(idsOf(groups, 'Pinned')).toEqual(['p-new', 'p-old']);
  });
});

// ---------------------------------------------------------------------------
// mode 'status' — a single By status group ranked working→waiting→idle
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// mode 'project' — Pinned + one section per project (project-list order)
// ---------------------------------------------------------------------------

describe("arrangeSessions mode 'project'", () => {
  const PROJECTS = [
    { id: 'proj-b', name: 'Beta' },
    { id: 'proj-a', name: 'Alpha' },
  ];

  it('emits one section per project, labeled by project name, in project-list order', () => {
    const items = [
      item('a1', { projectId: 'proj-a' }),
      item('b1', { projectId: 'proj-b', updatedAt: YESTERDAY_1000 }),
      item('b2', { projectId: 'proj-b', updatedAt: TODAY_1100 }),
    ];
    const groups = arrangeSessions(items, 'project', NOW, PROJECTS);
    expect(labels(groups)).toEqual(['Beta', 'Alpha']);
    expect(idsOf(groups, 'Beta')).toEqual(['b2', 'b1']);
    expect(idsOf(groups, 'Alpha')).toEqual(['a1']);
  });

  it('omits sections with zero matching sessions', () => {
    const items = [item('a1', { projectId: 'proj-a' })];
    const groups = arrangeSessions(items, 'project', NOW, PROJECTS);
    expect(labels(groups)).toEqual(['Alpha']);
  });

  it('surfaces pinned items in a leading Pinned section ahead of the project sections', () => {
    const items = [item('a1', { projectId: 'proj-a' }), item('b-pin', { projectId: 'proj-b', pinned: true })];
    const groups = arrangeSessions(items, 'project', NOW, PROJECTS);
    expect(labels(groups)).toEqual(['Pinned', 'Alpha']);
    expect(idsOf(groups, 'Pinned')).toEqual(['b-pin']);
  });

  it('groups sessions whose projectId is absent from the given project list into a trailing section keyed by that id', () => {
    const items = [item('a1', { projectId: 'proj-a' }), item('orphan1', { projectId: 'proj-ghost' })];
    const groups = arrangeSessions(items, 'project', NOW, PROJECTS);
    expect(labels(groups)).toEqual(['Alpha', 'proj-ghost']);
    expect(idsOf(groups, 'proj-ghost')).toEqual(['orphan1']);
  });

  it('returns an empty array for no items', () => {
    expect(arrangeSessions([], 'project', NOW, PROJECTS)).toEqual([]);
  });

  it('orders a project section by updatedAt, newest first', () => {
    const items = [
      item('a-old', { projectId: 'proj-a', updatedAt: EARLIER_MON }),
      item('a-new', { projectId: 'proj-a', updatedAt: TODAY_1100 }),
      item('a-mid', { projectId: 'proj-a', updatedAt: YESTERDAY_1000 }),
    ];
    const groups = arrangeSessions(items, 'project', NOW, PROJECTS);
    expect(idsOf(groups, 'Alpha')).toEqual(['a-new', 'a-mid', 'a-old']);
  });

  it('orders the unknown-project fallback section by updatedAt, newest first', () => {
    const items = [
      item('g-old', { projectId: 'proj-ghost', updatedAt: EARLIER_MON }),
      item('g-new', { projectId: 'proj-ghost', updatedAt: TODAY_1100 }),
    ];
    const groups = arrangeSessions(items, 'project', NOW, PROJECTS);
    expect(idsOf(groups, 'proj-ghost')).toEqual(['g-new', 'g-old']);
  });

  it('orders multiple ghost-project sections by their newest session, after every known-project section', () => {
    const items = [
      item('a1', { projectId: 'proj-a', updatedAt: TODAY_1100 }),
      item('gh1-old', { projectId: 'proj-ghost1', updatedAt: EARLIER_MON }),
      item('gh2-new', { projectId: 'proj-ghost2', updatedAt: TODAY_0900 }),
    ];
    const groups = arrangeSessions(items, 'project', NOW, PROJECTS);
    expect(labels(groups)).toEqual(['Alpha', 'proj-ghost2', 'proj-ghost1']);
  });

  it('tiebreaks ghost sections with identical newest activity by projectId ascending', () => {
    const items = [
      item('ghz1', { projectId: 'proj-ghost-z', updatedAt: TODAY_1100 }),
      item('ghy1', { projectId: 'proj-ghost-y', updatedAt: TODAY_1100 }),
    ];
    const groups = arrangeSessions(items, 'project', NOW, PROJECTS);
    expect(labels(groups)).toEqual(['proj-ghost-y', 'proj-ghost-z']);
  });

  it('lifts a pinned session out of its project section and still orders the remainder by recency', () => {
    const items = [
      item('a-old', { projectId: 'proj-a', updatedAt: EARLIER_MON }),
      item('a-pin', { projectId: 'proj-a', pinned: true, updatedAt: YESTERDAY_1000 }),
      item('a-new', { projectId: 'proj-a', updatedAt: TODAY_1100 }),
    ];
    const groups = arrangeSessions(items, 'project', NOW, PROJECTS);
    expect(idsOf(groups, 'Pinned')).toEqual(['a-pin']);
    expect(idsOf(groups, 'Alpha')).toEqual(['a-new', 'a-old']);
  });

  it('orders a multi-session Pinned group by recency in project mode (regression guard)', () => {
    const items = [
      item('pin-old', { projectId: 'proj-a', pinned: true, updatedAt: EARLIER_MON }),
      item('pin-new', { projectId: 'proj-b', pinned: true, updatedAt: TODAY_1100 }),
    ];
    const groups = arrangeSessions(items, 'project', NOW, PROJECTS);
    expect(idsOf(groups, 'Pinned')).toEqual(['pin-new', 'pin-old']);
  });
});

describe("arrangeSessions mode 'status'", () => {
  it('orders By status working then waiting then idle', () => {
    const items = [
      item('idle1', { displayStatus: 'idle' }),
      item('working1', { displayStatus: 'working' }),
      item('waiting1', { displayStatus: 'waiting' }),
    ];
    const groups = arrangeSessions(items, 'status', NOW);
    expect(labels(groups)).toEqual(['By status']);
    expect(idsOf(groups, 'By status')).toEqual(['working1', 'waiting1', 'idle1']);
  });

  it('surfaces pinned items in a Pinned group ahead of By status', () => {
    const items = [item('idle1', { displayStatus: 'idle' }), item('pin1', { pinned: true, displayStatus: 'idle' })];
    const groups = arrangeSessions(items, 'status', NOW);
    expect(labels(groups)).toEqual(['Pinned', 'By status']);
    expect(idsOf(groups, 'Pinned')).toEqual(['pin1']);
    expect(idsOf(groups, 'By status')).toEqual(['idle1']);
  });

  it('resolves same-status ties by updatedAt descending while rank order stays working/waiting/idle', () => {
    const items = [
      item('w1', { displayStatus: 'working', updatedAt: TODAY_0900 }),
      item('i-old', { displayStatus: 'idle', updatedAt: EARLIER_MON }),
      item('i-new', { displayStatus: 'idle', updatedAt: TODAY_1100 }),
    ];
    const groups = arrangeSessions(items, 'status', NOW);
    expect(idsOf(groups, 'By status')).toEqual(['w1', 'i-new', 'i-old']);
  });

  it('orders a multi-session Pinned group by recency in status mode', () => {
    const items = [
      item('p-old', { pinned: true, updatedAt: EARLIER_MON, displayStatus: 'idle' }),
      item('p-new', { pinned: true, updatedAt: TODAY_1100, displayStatus: 'idle' }),
    ];
    const groups = arrangeSessions(items, 'status', NOW);
    expect(idsOf(groups, 'Pinned')).toEqual(['p-new', 'p-old']);
  });
});

// ---------------------------------------------------------------------------
// arrangeSessions is independent of input order (shuffle invariance)
// ---------------------------------------------------------------------------

/** Deterministic PRNG (no Math.random, so a failing seed reproduces). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Decorate-sort-undecorate shuffle — no indexed swaps, which noUncheckedIndexedAccess rejects. */
function seededShuffle(items: SessionItem[], seed: number): SessionItem[] {
  const rand = mulberry32(seed);
  return items
    .map((it) => ({ it, k: rand() }))
    .sort((a, b) => a.k - b.k)
    .map((e) => e.it);
}

function serialize(groups: SessionGroupResult[]): [string, string[]][] {
  return groups.map((g) => [g.label, g.items.map((i) => i.id)]);
}

describe('arrangeSessions is independent of input order', () => {
  const PROJECTS = [
    { id: 'proj-a', name: 'Alpha' },
    { id: 'proj-b', name: 'Beta' },
  ];

  const fixture: SessionItem[] = [
    item('p1', { projectId: 'proj-a', pinned: true, updatedAt: TODAY_1100, displayStatus: 'working', title: 'Zulu' }),
    item('p2', {
      projectId: 'proj-b',
      pinned: true,
      updatedAt: YESTERDAY_1000,
      displayStatus: 'idle',
      title: 'Yankee',
    }),
    item('a1', { projectId: 'proj-a', updatedAt: TODAY_0900, displayStatus: 'working', title: 'Bravo' }),
    item('a2', { projectId: 'proj-a', updatedAt: EARLIER_MON, displayStatus: 'waiting', title: 'Echo' }),
    // a2/a3 share updatedAt (planted tie).
    item('a3', { projectId: 'proj-a', updatedAt: EARLIER_MON, displayStatus: 'idle', title: 'Foxtrot' }),
    item('b1', { projectId: 'proj-b', updatedAt: TODAY_1100, displayStatus: 'idle', title: 'Same Title' }),
    // b1/b2 share a title (planted tie).
    item('b2', { projectId: 'proj-b', updatedAt: YESTERDAY_1000, displayStatus: 'working', title: 'Same Title' }),
    item('g1', { projectId: 'proj-ghost1', updatedAt: TODAY_0900, displayStatus: 'waiting', title: 'Golf' }),
    item('g2', { projectId: 'proj-ghost2', updatedAt: EARLIER_MON, displayStatus: 'working', title: 'Hotel' }),
    item('g3', { projectId: 'proj-ghost1', updatedAt: EARLIER_MON, displayStatus: 'idle', title: 'India' }),
  ];

  const MODES: SortMode[] = ['recent', 'name', 'status', 'project'];
  const SEEDS = [1, 2, 3, 7, 42];

  for (const mode of MODES) {
    for (const seed of SEEDS) {
      it(`mode '${mode}' seed ${seed}: shuffled input yields identical output`, () => {
        const expected = serialize(arrangeSessions(fixture, mode, NOW, PROJECTS));
        const shuffled = seededShuffle(fixture, seed);
        const actual = serialize(arrangeSessions(shuffled, mode, NOW, PROJECTS));
        expect(actual).toEqual(expected);
      });
    }
  }
});
