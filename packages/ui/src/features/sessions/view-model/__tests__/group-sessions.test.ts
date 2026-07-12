import { describe, it, expect } from 'vitest';
import type { SessionItem, SessionCustom } from '../chat-to-thread-custom';
import { arrangeSessions, SESSION_SORTS } from '../group-sessions';

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
  it('exposes recent / name / status options in order', () => {
    expect(SESSION_SORTS.map((s) => s.id)).toEqual(['recent', 'name', 'status']);
  });

  it('labels each option', () => {
    expect(SESSION_SORTS.map((s) => s.label)).toEqual(['Recent activity', 'Name (A–Z)', 'Status']);
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
});

// ---------------------------------------------------------------------------
// mode 'status' — a single By status group ranked working→waiting→idle
// ---------------------------------------------------------------------------

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
});
