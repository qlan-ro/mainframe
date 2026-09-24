import { describe, it, expect } from 'vitest';
import type { SessionItem, SessionCustom } from '../chat-to-thread-custom';
import { classifyParent, forkCount, nestForks, parentLineageInteractive, parentLineageText } from '../fork-lineage';
import { arrangeSessions } from '../group-sessions';

function item(
  id: string,
  overrides: Partial<SessionCustom> & { title?: string; status?: 'regular' | 'archived' } = {},
): SessionItem {
  const { title, status, ...custom } = overrides;
  return {
    id,
    title: title ?? `Session ${id}`,
    status: status ?? 'regular',
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
      // A fixed default, not Date.now(): several cases rely on same-tick ties
      // breaking by id, which a real clock could occasionally not produce.
      updatedAt: 1_780_000_000_000,
      ...custom,
    },
  };
}

function ids(rows: { item: SessionItem }[]): string[] {
  return rows.map((r) => r.item.id);
}

function depths(rows: { item: SessionItem; depth: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.item.id] = r.depth;
  return out;
}

describe('nestForks', () => {
  it('leaves a parentless list in its incoming order, all at depth 0', () => {
    const items = [item('a'), item('b'), item('c')];
    const rows = nestForks(items);
    expect(ids(rows)).toEqual(['a', 'b', 'c']);
    expect(depths(rows)).toEqual({ a: 0, b: 0, c: 0 });
  });

  it("nests a fork directly after its parent at the parent's own position, even when the fork itself sorted earlier", () => {
    const items = [item('fork', { parentChatId: 'parent' }), item('other'), item('parent')];
    const rows = nestForks(items);
    // 'other' is the only other root, so it keeps its own position; 'parent'
    // (a root) is followed immediately by its child 'fork', regardless of
    // where 'fork' sorted in the input.
    expect(ids(rows)).toEqual(['other', 'parent', 'fork']);
    expect(depths(rows)).toEqual({ other: 0, parent: 0, fork: 1 });
  });

  it("places a root's whole descendant block at the root's own position", () => {
    const items = [
      item('parent'),
      item('sibling'),
      item('fork1', { parentChatId: 'parent' }),
      item('fork2', { parentChatId: 'parent' }),
    ];
    const rows = nestForks(items);
    expect(ids(rows)).toEqual(['parent', 'fork1', 'fork2', 'sibling']);
    expect(depths(rows)).toEqual({ parent: 0, fork1: 1, fork2: 1, sibling: 0 });
  });

  it('keeps descendant siblings in the group order they arrived in', () => {
    const items = [
      item('parent'),
      item('fork-b', { parentChatId: 'parent' }),
      item('fork-a', { parentChatId: 'parent' }),
    ];
    const rows = nestForks(items);
    expect(ids(rows)).toEqual(['parent', 'fork-b', 'fork-a']);
  });

  it('caps indentation at two levels for a fork-of-a-fork-of-a-fork', () => {
    const items = [
      item('root'),
      item('gen1', { parentChatId: 'root' }),
      item('gen2', { parentChatId: 'gen1' }),
      item('gen3', { parentChatId: 'gen2' }),
    ];
    const rows = nestForks(items);
    expect(ids(rows)).toEqual(['root', 'gen1', 'gen2', 'gen3']);
    expect(depths(rows)).toEqual({ root: 0, gen1: 1, gen2: 2, gen3: 2 });
  });

  it('leaves a fork whose parent is not in this array flat at depth 0', () => {
    const items = [item('fork', { parentChatId: 'not-here' }), item('other')];
    const rows = nestForks(items);
    expect(ids(rows)).toEqual(['fork', 'other']);
    expect(depths(rows)).toEqual({ fork: 0, other: 0 });
  });

  it('renders a self-referencing chat flat and terminates', () => {
    const items = [item('self', { parentChatId: 'self' }), item('other')];
    const rows = nestForks(items);
    expect(ids(rows)).toEqual(['self', 'other']);
    expect(depths(rows).self).toBe(0);
  });

  it('renders a two-chat cycle flat and terminates', () => {
    const items = [item('a', { parentChatId: 'b' }), item('b', { parentChatId: 'a' })];
    const rows = nestForks(items);
    expect(ids(rows).sort()).toEqual(['a', 'b']);
    expect(rows).toHaveLength(2);
  });

  it('returns an empty array for no items', () => {
    expect(nestForks([])).toEqual([]);
  });
});

describe('nestForks integrated through arrangeSessions (every sort mode)', () => {
  // Fixed reference clock, matching group-sessions.test.ts's convention — a
  // real Date.now() would make the "different group" case's day-bucketing flaky.
  const NOW = new Date(2026, 5, 7, 12, 0, 0).getTime();
  const TODAY = new Date(2026, 5, 7, 9, 0, 0).getTime();
  const EARLIER = new Date(2026, 5, 1, 8, 0, 0).getTime();

  it("nests in mode 'recent', at the parent's own position", () => {
    const items = [
      item('parent', { updatedAt: TODAY }),
      item('unrelated', { updatedAt: NOW }),
      item('fork', { parentChatId: 'parent', updatedAt: NOW }),
    ];
    const groups = arrangeSessions(items, 'recent', NOW);
    const today = groups.find((g) => g.label === 'Today')!;
    // Sorted by recency first (unrelated, fork, parent) — nesting then moves
    // fork's block to sit right after parent, without moving parent itself.
    expect(today.items.map((i) => i.id)).toEqual(['unrelated', 'parent', 'fork']);
    expect(today.depths.fork).toBe(1);
  });

  it("nests in mode 'name', at the parent's own position", () => {
    const items = [item('parent', { title: 'Zulu' }), item('fork', { parentChatId: 'parent', title: 'Alpha' })];
    const groups = arrangeSessions(items, 'name', NOW);
    const az = groups.find((g) => g.label === 'A–Z')!;
    expect(az.items.map((i) => i.id)).toEqual(['parent', 'fork']);
    expect(az.depths.fork).toBe(1);
  });

  it("nests in mode 'status', at the parent's own position", () => {
    const items = [
      item('parent', { displayStatus: 'idle' }),
      item('fork', { parentChatId: 'parent', displayStatus: 'working' }),
    ];
    const groups = arrangeSessions(items, 'status', NOW);
    const byStatus = groups.find((g) => g.label === 'By status')!;
    expect(byStatus.items.map((i) => i.id)).toEqual(['parent', 'fork']);
  });

  it("nests in mode 'project', at the parent's own position", () => {
    const items = [
      item('parent', { projectId: 'proj-a' }),
      item('fork', { parentChatId: 'parent', projectId: 'proj-a' }),
    ];
    const groups = arrangeSessions(items, 'project', NOW, [{ id: 'proj-a', name: 'Alpha' }]);
    const alpha = groups.find((g) => g.label === 'Alpha')!;
    expect(alpha.items.map((i) => i.id)).toEqual(['parent', 'fork']);
  });

  it('applies nesting inside the Pinned group too', () => {
    const items = [
      item('parent', { pinned: true, updatedAt: EARLIER }),
      item('fork', { parentChatId: 'parent', pinned: true, updatedAt: NOW }),
    ];
    const groups = arrangeSessions(items, 'recent', NOW);
    const pinned = groups.find((g) => g.label === 'Pinned')!;
    // Sorted by recency first (fork, parent) — nesting keeps parent's own
    // sorted position and moves fork's block right after it.
    expect(pinned.items.map((i) => i.id)).toEqual(['parent', 'fork']);
    expect(pinned.depths.fork).toBe(1);
  });

  it('leaves a fork whose parent lands in a different group unnested at depth 0', () => {
    const items = [item('parent', { updatedAt: EARLIER }), item('fork', { parentChatId: 'parent', updatedAt: NOW })];
    const groups = arrangeSessions(items, 'recent', NOW);
    const today = groups.find((g) => g.label === 'Today')!;
    expect(today.items.map((i) => i.id)).toEqual(['fork']);
    expect(today.depths.fork ?? 0).toBe(0);
    const earlier = groups.find((g) => g.label === 'Earlier')!;
    expect(earlier.items.map((i) => i.id)).toEqual(['parent']);
  });
});

describe('forkCount', () => {
  it('counts listed, non-archived direct forks and excludes self', () => {
    const items = [
      item('parent'),
      item('fork1', { parentChatId: 'parent' }),
      item('fork2', { parentChatId: 'parent' }),
      item('archived-fork', { parentChatId: 'parent', status: 'archived' }),
      item('unrelated'),
    ];
    expect(forkCount(items, 'parent')).toBe(2);
  });

  it('returns 0 for a chat with no forks', () => {
    expect(forkCount([item('solo')], 'solo')).toBe(0);
  });

  it('does not count a self-referencing chat as its own fork', () => {
    const items = [item('self', { parentChatId: 'self' })];
    expect(forkCount(items, 'self')).toBe(0);
  });
});

describe('classifyParent', () => {
  it('returns none when the item has no parentChatId', () => {
    expect(classifyParent(undefined, new Set(), new Set())).toBe('none');
    expect(classifyParent(null, new Set(), new Set())).toBe('none');
  });

  it('returns different-group when the parent is listed elsewhere', () => {
    expect(classifyParent('p1', new Set(['p1']), new Set(['p1']))).toBe('different-group');
  });

  it('returns filtered-out when the parent is loaded but not listed in any group', () => {
    expect(classifyParent('p1', new Set(), new Set(['p1']))).toBe('filtered-out');
  });

  it('returns unresolved when the parent is not in the loaded set at all', () => {
    expect(classifyParent('p1', new Set(), new Set())).toBe('unresolved');
  });
});

describe('parentLineageText', () => {
  it('matches the Sidebar section for a parent listed in a different group', () => {
    expect(parentLineageText({ kind: 'different-group', title: 'My Chat' })).toBe(
      `Forked from "My Chat" — in a different group, so it can't nest here`,
    );
  });

  it('matches the Sidebar section for a filtered-out parent', () => {
    expect(parentLineageText({ kind: 'filtered-out', title: 'My Chat' })).toBe('Forked from "My Chat"');
  });

  it('matches the header wording for a directly-linked parent (same as filtered-out)', () => {
    expect(parentLineageText({ kind: 'linked', title: 'My Chat' })).toBe('Forked from "My Chat"');
  });

  it('matches the Sidebar section for an archived parent', () => {
    expect(parentLineageText({ kind: 'archived', title: 'My Chat' })).toBe('Forked from "My Chat" (archived)');
  });

  it('matches the Sidebar section for a deleted parent', () => {
    expect(parentLineageText({ kind: 'deleted' })).toBe('Forked from a deleted chat');
  });
});

describe('parentLineageInteractive', () => {
  it('is interactive for different-group, filtered-out and linked', () => {
    expect(parentLineageInteractive({ kind: 'different-group', title: 'x' })).toBe(true);
    expect(parentLineageInteractive({ kind: 'filtered-out', title: 'x' })).toBe(true);
    expect(parentLineageInteractive({ kind: 'linked', title: 'x' })).toBe(true);
  });

  it('is not interactive for archived or deleted', () => {
    expect(parentLineageInteractive({ kind: 'archived', title: 'x' })).toBe(false);
    expect(parentLineageInteractive({ kind: 'deleted' })).toBe(false);
  });
});
