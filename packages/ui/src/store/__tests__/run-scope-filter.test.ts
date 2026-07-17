/**
 * filterRunByScope — filters a RunState to only the tabs that belong to the
 * active session's launch scope.
 *
 * STRICT matching: a tab is kept ONLY when its scopeKey (or null when absent)
 * equals the activeScopeKey exactly.
 *   - scopeKey 'proj-A:/ws/a'  matches activeScopeKey 'proj-A:/ws/a'
 *   - no scopeKey (undefined)  matches activeScopeKey null ONLY
 *   - no scopeKey (undefined)  is DROPPED when activeScopeKey is non-null
 *
 * A pane left with zero surviving tabs is dropped entirely. When no panes
 * survive the function returns null. The pane's `active` pointer is fixed up
 * if the formerly-active tab was dropped: it becomes the first surviving tab.
 *
 * flex rule (mirrors closeRunTab): exactly one surviving pane → [1,1];
 * two surviving panes → keep original flex.
 */
import { describe, it, expect } from 'vitest';
import { filterRunByScope } from '../run-scope-filter';
import type { RunState } from '../run-pane';

const SCOPE_A = 'proj-A:/ws/a';
const SCOPE_B = 'proj-B:/ws/b';
const SCOPE_C = 'proj-C:/x';

// ---------------------------------------------------------------------------
// Shared fixture: one pane, active 't2', tabs:
//   t1 — preview, SCOPE_A
//   t2 — preview, SCOPE_B
//   t3 — terminal, NO scopeKey
// ---------------------------------------------------------------------------
function buildMixedPaneRun(): RunState {
  return {
    dir: 'v',
    flex: [1, 1],
    panes: [
      {
        id: 'pane-1',
        active: 't2',
        tabs: [
          { id: 't1', kind: 'preview', title: 'A', config: 'dev', scopeKey: SCOPE_A },
          { id: 't2', kind: 'preview', title: 'B', config: 'dev', scopeKey: SCOPE_B },
          { id: 't3', kind: 'terminal', title: 'sh' },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Shared fixture: two panes, each with exactly one scoped preview tab
//   P1: tab 'a', SCOPE_A
//   P2: tab 'b', SCOPE_B
//   flex [0.3, 0.7], dir 'v'
// ---------------------------------------------------------------------------
function buildTwoPaneRun(): RunState {
  return {
    dir: 'v',
    flex: [0.3, 0.7],
    panes: [
      {
        id: 'pane-P1',
        active: 'a',
        tabs: [{ id: 'a', kind: 'preview', title: 'A', config: 'dev', scopeKey: SCOPE_A }],
      },
      {
        id: 'pane-P2',
        active: 'b',
        tabs: [{ id: 'b', kind: 'preview', title: 'B', config: 'dev', scopeKey: SCOPE_B }],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Null input
// ---------------------------------------------------------------------------
describe('filterRunByScope — null run', () => {
  it('returns null when run is null and activeScopeKey is non-null', () => {
    expect(filterRunByScope(null, SCOPE_A)).toBeNull();
  });

  it('returns null when run is null and activeScopeKey is null', () => {
    expect(filterRunByScope(null, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Single-pane: mixed tabs filtered by SCOPE_A (strict)
// t1 kept (SCOPE_A matches), t2 dropped (SCOPE_B ≠ SCOPE_A), t3 dropped (no scopeKey ≠ non-null)
// ---------------------------------------------------------------------------
describe('filterRunByScope — single pane, filter by SCOPE_A (strict)', () => {
  it('keeps only t1, fixes active to it, preserves dir, and resets flex to [1,1]', () => {
    const result = filterRunByScope(buildMixedPaneRun(), SCOPE_A);
    expect(result).not.toBeNull();
    expect(result!.panes[0]!.tabs.map((t) => t.id)).toEqual(['t1']);
    expect(result!.panes[0]!.active).toBe('t1');
    expect(result!.dir).toBe('v');
    expect(result!.flex).toEqual([1, 1]);
  });
});

// ---------------------------------------------------------------------------
// Single-pane: mixed tabs filtered by SCOPE_B (strict)
// t2 kept (SCOPE_B matches), t1 dropped (SCOPE_A), t3 dropped (no scopeKey ≠ non-null)
// ---------------------------------------------------------------------------
describe('filterRunByScope — single pane, filter by SCOPE_B (strict)', () => {
  it('keeps only t2; drops t1 (wrong scope) and t3 (no scope)', () => {
    const result = filterRunByScope(buildMixedPaneRun(), SCOPE_B);
    expect(result).not.toBeNull();
    expect(result!.panes[0]!.tabs.map((t) => t.id)).toEqual(['t2']);
  });

  it('keeps active as t2 because t2 survived', () => {
    const result = filterRunByScope(buildMixedPaneRun(), SCOPE_B);
    expect(result!.panes[0]!.active).toBe('t2');
  });
});

// ---------------------------------------------------------------------------
// Single-pane: activeScopeKey null → only no-scope tabs survive
// t3 kept (no scopeKey matches null), t1 and t2 dropped (scoped ≠ null)
// ---------------------------------------------------------------------------
describe('filterRunByScope — activeScopeKey null (unresolved session)', () => {
  it('keeps only t3 (no scopeKey); drops both scoped preview tabs', () => {
    const result = filterRunByScope(buildMixedPaneRun(), null);
    expect(result).not.toBeNull();
    expect(result!.panes[0]!.tabs.map((t) => t.id)).toEqual(['t3']);
  });

  it('sets active to t3 (the only surviving tab)', () => {
    const result = filterRunByScope(buildMixedPaneRun(), null);
    expect(result!.panes[0]!.active).toBe('t3');
  });
});

// ---------------------------------------------------------------------------
// KEY FLIP: a pane with ONLY a terminal (no scopeKey)
//   filter null   → pane survives (no-scope matches null)
//   filter SCOPE_C → pane empties → whole result is null
// ---------------------------------------------------------------------------
describe('filterRunByScope — terminal-only pane, strict scope matching', () => {
  const termOnlyRun: RunState = {
    dir: 'v',
    flex: [1, 1],
    panes: [
      {
        id: 'pane-only',
        active: 'term-1',
        tabs: [{ id: 'term-1', kind: 'terminal', title: 'shell' }],
      },
    ],
  };

  it('keeps the terminal pane when activeScopeKey is null (no-scope matches null)', () => {
    const result = filterRunByScope(termOnlyRun, null);
    expect(result).not.toBeNull();
    expect(result!.panes[0]!.tabs.map((t) => t.id)).toEqual(['term-1']);
  });

  it('returns null when activeScopeKey is non-null (no-scope tab is DROPPED)', () => {
    // This is the KEY flip from lenient → strict: a no-scope tab is NOT kept
    // under a non-null active scope.
    expect(filterRunByScope(termOnlyRun, SCOPE_C)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Two-pane: one pane survives
// ---------------------------------------------------------------------------
describe('filterRunByScope — two-pane, one pane survives', () => {
  it('returns only P1 with tab [a] when filtering by SCOPE_A; flex becomes [1,1]', () => {
    const result = filterRunByScope(buildTwoPaneRun(), SCOPE_A);
    expect(result).not.toBeNull();
    expect(result!.panes.map((p) => p.id)).toEqual(['pane-P1']);
    expect(result!.panes[0]!.tabs.map((t) => t.id)).toEqual(['a']);
    expect(result!.flex).toEqual([1, 1]);
  });

  it('returns only P2 with tab [b] when filtering by SCOPE_B; flex becomes [1,1]', () => {
    const result = filterRunByScope(buildTwoPaneRun(), SCOPE_B);
    expect(result).not.toBeNull();
    expect(result!.panes.map((p) => p.id)).toEqual(['pane-P2']);
    expect(result!.panes[0]!.tabs.map((t) => t.id)).toEqual(['b']);
    expect(result!.flex).toEqual([1, 1]);
  });

  it('returns null when filtering by SCOPE_C (matches neither pane)', () => {
    expect(filterRunByScope(buildTwoPaneRun(), SCOPE_C)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Two-pane: both panes survive — original flex preserved
// Both panes carry SCOPE_A tabs so both survive under SCOPE_A.
// ---------------------------------------------------------------------------
describe('filterRunByScope — two-pane, both panes survive (scope-driven)', () => {
  it('preserves original flex [0.4, 0.6] when both SCOPE_A panes survive', () => {
    const run: RunState = {
      dir: 'h',
      flex: [0.4, 0.6],
      panes: [
        {
          id: 'pane-P1',
          active: 'a',
          tabs: [{ id: 'a', kind: 'preview', title: 'A', config: 'dev', scopeKey: SCOPE_A }],
        },
        {
          id: 'pane-P2',
          active: 'b',
          tabs: [{ id: 'b', kind: 'preview', title: 'B', config: 'dev', scopeKey: SCOPE_A }],
        },
      ],
    };
    const result = filterRunByScope(run, SCOPE_A);
    expect(result).not.toBeNull();
    expect(result!.panes.map((p) => p.id)).toEqual(['pane-P1', 'pane-P2']);
    expect(result!.flex).toEqual([0.4, 0.6]);
  });
});

// ---------------------------------------------------------------------------
// Active pointer fix-up
// ---------------------------------------------------------------------------
describe('filterRunByScope — active tab fix-up', () => {
  it('keeps active unchanged when the active tab (SCOPE_A) survives filter SCOPE_A', () => {
    const run: RunState = {
      dir: 'v',
      flex: [1, 1],
      panes: [
        {
          id: 'pane-1',
          active: 't1',
          tabs: [
            { id: 't1', kind: 'preview', title: 'A', config: 'dev', scopeKey: SCOPE_A },
            { id: 't9', kind: 'preview', title: 'Z', config: 'dev', scopeKey: SCOPE_A },
          ],
        },
      ],
    };
    const result = filterRunByScope(run, SCOPE_A);
    expect(result!.panes[0]!.active).toBe('t1');
  });

  it('sets active to the first survivor when active tab (SCOPE_B) is dropped by filter SCOPE_A', () => {
    const run: RunState = {
      dir: 'v',
      flex: [1, 1],
      panes: [
        {
          id: 'pane-1',
          active: 't1',
          tabs: [
            { id: 't1', kind: 'preview', title: 'B', config: 'dev', scopeKey: SCOPE_B },
            { id: 't9', kind: 'preview', title: 'A', config: 'dev', scopeKey: SCOPE_A },
          ],
        },
      ],
    };
    const result = filterRunByScope(run, SCOPE_A);
    expect(result!.panes[0]!.tabs.map((t) => t.id)).toEqual(['t9']);
    expect(result!.panes[0]!.active).toBe('t9');
  });
});

// ---------------------------------------------------------------------------
// All-match passthrough: every tab belongs to the active scope
// ---------------------------------------------------------------------------
describe('filterRunByScope — all tabs match (nothing to drop)', () => {
  it('preserves tab ids and order when every tab belongs to the active scope', () => {
    const run: RunState = {
      dir: 'v',
      flex: [1, 1],
      panes: [
        {
          id: 'pane-1',
          active: 'p1',
          tabs: [
            { id: 'p1', kind: 'preview', title: 'P', config: 'dev', scopeKey: SCOPE_A },
            { id: 'p2', kind: 'console', title: 'C', config: 'dev', scopeKey: SCOPE_A },
          ],
        },
      ],
    };
    const result = filterRunByScope(run, SCOPE_A);
    expect(result!.panes[0]!.tabs.map((t) => t.id)).toEqual(['p1', 'p2']);
    expect(result!.panes[0]!.active).toBe('p1');
  });
});
