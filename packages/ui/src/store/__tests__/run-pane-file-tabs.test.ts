/**
 * File-tab semantics on the workspace pane model — the preview-vs-permanent
 * rules ported from the retired file tab store (`tabs.test.ts`), plus the
 * per-pane and per-scope behaviour the merge adds.
 *
 * Behaviour-based with hardcoded expectations; pure reducers, no store.
 */
import { describe, expect, it } from 'vitest';
import { addRunTab, closeRunTab, emptyRun, type RunState, type RunTab } from '../run-pane';
import { isFileTab, moveTabToPaneEdge, openFileTab, promoteFileTab, type OpenFileTarget } from '../run-pane-file-tabs';

const code = (path: string, extra: Partial<OpenFileTarget> = {}): OpenFileTarget => ({
  kind: 'code',
  path,
  title: path.split('/').pop()!,
  ...extra,
});

function paneTabs(run: RunState, idx = 0): RunTab[] {
  return run.panes[idx]!.tabs;
}

function split(): RunState {
  // Two panes: pane 0 holds a terminal, pane 1 is the second half of the split.
  const one = addRunTab(null, { id: 'term', kind: 'terminal', title: 'zsh' })!;
  return moveTabToPaneEdge(addRunTab(one, { id: 'term2', kind: 'terminal', title: 'zsh 2' })!, 'term2', 'right');
}

// ── openFileTab — preview mode ───────────────────────────────────────────────

describe('openFileTab — preview mode', () => {
  it('opens a preview tab into the first pane and focuses it', () => {
    const { run, tabId } = openFileTab(null, code('/a.ts'), 'preview');
    expect(paneTabs(run)).toHaveLength(1);
    expect(paneTabs(run)[0]!.path).toBe('/a.ts');
    expect(paneTabs(run)[0]!.mode).toBe('preview');
    expect(run.panes[0]!.active).toBe(tabId);
  });

  it('a second open REUSES the preview slot in place', () => {
    const first = openFileTab(null, code('/a.ts'), 'preview');
    const second = openFileTab(first.run, code('/b.ts'), 'preview');

    expect(paneTabs(second.run)).toHaveLength(1);
    expect(paneTabs(second.run)[0]!.path).toBe('/b.ts');
    expect(paneTabs(second.run)[0]!.id).not.toBe(first.tabId);
    expect(paneTabs(second.run)[0]!.mode).toBe('preview');
    expect(second.run.panes[0]!.active).toBe(second.tabId);
  });

  it('the preview slot replacement keeps the strip position', () => {
    let run = openFileTab(null, code('/pinned.ts'), 'permanent').run;
    run = openFileTab(run, code('/a.ts'), 'preview').run;
    run = openFileTab(run, code('/tail.ts'), 'permanent').run;

    run = openFileTab(run, code('/b.ts'), 'preview').run;

    expect(paneTabs(run).map((t) => t.path)).toEqual(['/pinned.ts', '/b.ts', '/tail.ts']);
  });

  it('opening an already-open file focuses it without adding a duplicate', () => {
    const first = openFileTab(null, code('/a.ts'), 'preview');
    const second = openFileTab(first.run, code('/a.ts'), 'preview');

    expect(paneTabs(second.run)).toHaveLength(1);
    expect(second.tabId).toBe(first.tabId);
  });

  it('opening an already-open file with permanent promotes it', () => {
    const first = openFileTab(null, code('/a.ts'), 'preview');
    const second = openFileTab(first.run, code('/a.ts'), 'permanent');

    expect(paneTabs(second.run)).toHaveLength(1);
    expect(paneTabs(second.run)[0]!.id).toBe(first.tabId);
    expect(paneTabs(second.run)[0]!.mode).toBe('permanent');
  });

  it('re-opening a preview tab with preview does NOT demote a promoted tab', () => {
    let run = openFileTab(null, code('/a.ts'), 'permanent').run;
    run = openFileTab(run, code('/a.ts'), 'preview').run;
    expect(paneTabs(run)[0]!.mode).toBe('permanent');
  });
});

describe('openFileTab — permanent mode', () => {
  it('appends and never replaces the preview slot', () => {
    let run = openFileTab(null, code('/preview.ts'), 'preview').run;
    run = openFileTab(run, code('/perm.ts'), 'permanent').run;

    expect(paneTabs(run)).toHaveLength(2);
    expect(paneTabs(run).find((t) => t.path === '/preview.ts')!.mode).toBe('preview');
    expect(paneTabs(run).find((t) => t.path === '/perm.ts')!.mode).toBe('permanent');
  });
});

// ── per-pane preview slot ────────────────────────────────────────────────────

describe('openFileTab — the preview slot is PER PANE', () => {
  it('a preview in pane 1 does not replace the preview in pane 0', () => {
    const base = split();
    const [p0, p1] = base.panes.map((p) => p.id);

    let run = openFileTab(base, code('/a.ts'), 'preview', p0).run;
    run = openFileTab(run, code('/b.ts'), 'preview', p1).run;

    expect(run.panes[0]!.tabs.filter((t) => t.mode === 'preview').map((t) => t.path)).toEqual(['/a.ts']);
    expect(run.panes[1]!.tabs.filter((t) => t.mode === 'preview').map((t) => t.path)).toEqual(['/b.ts']);
  });

  it('a file already open in ANOTHER pane is focused there, not duplicated', () => {
    const base = split();
    const [p0, p1] = base.panes.map((p) => p.id);

    const opened = openFileTab(base, code('/a.ts'), 'preview', p1);
    const again = openFileTab(opened.run, code('/a.ts'), 'preview', p0);

    expect(again.tabId).toBe(opened.tabId);
    expect(again.run.panes[0]!.tabs.some((t) => t.path === '/a.ts')).toBe(false);
    expect(again.run.panes[1]!.active).toBe(opened.tabId);
  });

  it('an unknown paneId falls back to the first pane rather than dropping the open', () => {
    const { run } = openFileTab(emptyRun(), code('/a.ts'), 'preview', 'pane-gone');
    expect(paneTabs(run).map((t) => t.path)).toEqual(['/a.ts']);
  });
});

// ── scope ────────────────────────────────────────────────────────────────────

describe('openFileTab — scope', () => {
  it('stamps the target scopeKey onto the tab', () => {
    const { run } = openFileTab(null, code('/a.ts', { scopeKey: 'proj:/wt' }), 'preview');
    expect(paneTabs(run)[0]!.scopeKey).toBe('proj:/wt');
  });

  it('the preview slot is per scope — a preview in scope B keeps scope A’s preview', () => {
    const a = openFileTab(null, code('/a.ts', { scopeKey: 'proj:/wt-a' }), 'preview');
    const b = openFileTab(a.run, code('/b.ts', { scopeKey: 'proj:/wt-b' }), 'preview');

    expect(paneTabs(b.run).map((t) => [t.path, t.scopeKey])).toEqual([
      ['/a.ts', 'proj:/wt-a'],
      ['/b.ts', 'proj:/wt-b'],
    ]);
  });

  it('a second preview WITHIN a scope still replaces that scope’s slot', () => {
    let run = openFileTab(null, code('/a.ts', { scopeKey: 'proj:/wt-a' }), 'preview').run;
    run = openFileTab(run, code('/other.ts', { scopeKey: 'proj:/wt-b' }), 'preview').run;
    run = openFileTab(run, code('/b.ts', { scopeKey: 'proj:/wt-a' }), 'preview').run;

    expect(paneTabs(run).map((t) => t.path)).toEqual(['/b.ts', '/other.ts']);
  });

  it('the same path in a DIFFERENT scope is a different tab', () => {
    const first = openFileTab(null, code('/a.ts', { scopeKey: 'proj:/wt-a' }), 'permanent');
    const second = openFileTab(first.run, code('/a.ts', { scopeKey: 'proj:/wt-b' }), 'permanent');

    expect(paneTabs(second.run)).toHaveLength(2);
    expect(second.tabId).not.toBe(first.tabId);
  });
});

// ── diff tabs ────────────────────────────────────────────────────────────────

describe('openFileTab — diff tabs', () => {
  it('carries the pre-resolved sides onto the tab', () => {
    const { run } = openFileTab(
      null,
      { kind: 'diff', path: '/a.ts', title: 'a.ts', original: 'old\n', modified: 'new\n' },
      'preview',
    );
    expect(paneTabs(run)[0]!.kind).toBe('diff');
    expect(paneTabs(run)[0]!.original).toBe('old\n');
    expect(paneTabs(run)[0]!.modified).toBe('new\n');
  });

  it('re-opening a diff refreshes its sides instead of showing a stale diff', () => {
    const first = openFileTab(
      null,
      { kind: 'diff', path: '/a.ts', title: 'a.ts', original: 'v1', modified: 'v2' },
      'preview',
    );
    const second = openFileTab(
      first.run,
      { kind: 'diff', path: '/a.ts', title: 'a.ts', original: 'v2', modified: 'v3' },
      'preview',
    );

    expect(paneTabs(second.run)).toHaveLength(1);
    expect(second.tabId).toBe(first.tabId);
    expect(paneTabs(second.run)[0]!.original).toBe('v2');
    expect(paneTabs(second.run)[0]!.modified).toBe('v3');
  });

  it('a diff and a code tab on the same path coexist (different kinds)', () => {
    let run = openFileTab(null, code('/a.ts'), 'permanent').run;
    run = openFileTab(run, { kind: 'diff', path: '/a.ts', title: 'a.ts' }, 'permanent').run;
    expect(paneTabs(run).map((t) => t.kind)).toEqual(['code', 'diff']);
  });
});

// ── promoteFileTab ───────────────────────────────────────────────────────────

describe('promoteFileTab', () => {
  it('promotes a preview tab to permanent', () => {
    const { run, tabId } = openFileTab(null, code('/a.ts'), 'preview');
    const next = promoteFileTab(run, tabId);
    expect(next.panes[0]!.tabs[0]!.mode).toBe('permanent');
    expect(next.panes[0]!.tabs[0]!.id).toBe(tabId);
  });

  it('promoting an already-permanent tab returns the same state', () => {
    const { run, tabId } = openFileTab(null, code('/a.ts'), 'permanent');
    expect(promoteFileTab(run, tabId)).toBe(run);
  });

  it('an unknown tab id returns the same state', () => {
    const { run } = openFileTab(null, code('/a.ts'), 'preview');
    expect(promoteFileTab(run, 'nope')).toBe(run);
  });

  it('promotes a tab in the second pane', () => {
    const base = split();
    const p1 = base.panes[1]!.id;
    const { run, tabId } = openFileTab(base, code('/a.ts'), 'preview', p1);
    const next = promoteFileTab(run, tabId);
    expect(next.panes[1]!.tabs.find((t) => t.id === tabId)!.mode).toBe('permanent');
  });
});

// ── closing (the shared reducer, applied to file tabs) ───────────────────────

describe('closeRunTab on file tabs', () => {
  it('closing the active tab focuses the last survivor', () => {
    let run = openFileTab(null, code('/a.ts'), 'permanent').run;
    const second = openFileTab(run, code('/b.ts'), 'permanent');
    run = second.run;
    expect(run.panes[0]!.active).toBe(second.tabId);

    const next = closeRunTab(run, run.panes[0]!.id, second.tabId)!;
    expect(next.panes[0]!.tabs.map((t) => t.path)).toEqual(['/a.ts']);
    expect(next.panes[0]!.active).toBe(next.panes[0]!.tabs[0]!.id);
  });

  it('closing the only tab empties the workspace', () => {
    const { run, tabId } = openFileTab(null, code('/a.ts'), 'permanent');
    expect(closeRunTab(run, run.panes[0]!.id, tabId)).toBeNull();
  });
});

// ── moveTabToPaneEdge ────────────────────────────────────────────────────────

describe('moveTabToPaneEdge', () => {
  it('an edge drop splits the workspace and keeps the tab id', () => {
    let run = openFileTab(null, code('/a.ts'), 'permanent').run;
    const moved = openFileTab(run, code('/b.ts'), 'permanent');
    run = moveTabToPaneEdge(moved.run, moved.tabId, 'right');

    expect(run.panes).toHaveLength(2);
    expect(run.dir).toBe('v');
    expect(run.panes[0]!.tabs.map((t) => t.path)).toEqual(['/a.ts']);
    expect(run.panes[1]!.tabs.map((t) => t.id)).toEqual([moved.tabId]);
  });

  it('a bottom drop splits horizontally', () => {
    const first = openFileTab(null, code('/a.ts'), 'permanent');
    const second = openFileTab(first.run, code('/b.ts'), 'permanent');
    expect(moveTabToPaneEdge(second.run, second.tabId, 'bottom').dir).toBe('h');
  });

  it('a center drop joins the first pane', () => {
    const base = split();
    const term2 = base.panes[1]!.tabs[0]!.id;
    const run = moveTabToPaneEdge(base, term2, 'center');
    expect(run.panes).toHaveLength(1);
    expect(run.panes[0]!.tabs.map((t) => t.id)).toEqual(['term', 'term2']);
  });

  it('moving the workspace’s only tab is a no-op', () => {
    const { run, tabId } = openFileTab(null, code('/a.ts'), 'permanent');
    expect(moveTabToPaneEdge(run, tabId, 'right')).toBe(run);
  });

  it('an unknown tab id is a no-op', () => {
    const { run } = openFileTab(null, code('/a.ts'), 'permanent');
    expect(moveTabToPaneEdge(run, 'nope', 'right')).toBe(run);
  });
});

// ── isFileTab ────────────────────────────────────────────────────────────────

describe('isFileTab', () => {
  it('is true for the four file-backed kinds and false for the rest', () => {
    const kinds: RunTab['kind'][] = ['code', 'diff', 'skill', 'viewer', 'preview', 'console', 'terminal', 'url'];
    const flags = kinds.map((kind) => isFileTab({ id: kind, kind, title: kind }));
    expect(flags).toEqual([true, true, true, true, false, false, false, false]);
  });
});
