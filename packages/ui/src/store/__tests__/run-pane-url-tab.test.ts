/**
 * URL tab model: dedup within addRunTab, scope release, kind-parameterized id
 * collectors, and the retargetUrlTab reducer (#281, plan tasks 2 and 8).
 *
 * `tabIdsInRun` / `tabIdsInPane` / `tabIdsForScope` replace the terminal-only
 * `terminalIds*` helpers with a `kind` parameter (task 8 item 4); this file
 * exercises them for both `'url'` and `'terminal'` so the generalization is
 * covered, not just the new kind.
 */
import { describe, it, expect } from 'vitest';
import {
  addRunTab,
  releaseRunScope,
  retargetUrlTab,
  tabIdsForScope,
  tabIdsInPane,
  tabIdsInRun,
  type RunState,
  type RunTab,
} from '../run-pane';

const urlTab = (id: string, url: string, scopeKey = 'scope-a'): RunTab => ({
  id,
  kind: 'url',
  title: url,
  url,
  scopeKey,
});

describe('addRunTab — url tab dedup', () => {
  it('appends a new url tab and focuses it', () => {
    const run = addRunTab(null, urlTab('u1', 'http://localhost:5173/'))!;
    expect(run.panes[0]!.tabs.map((t) => t.id)).toEqual(['u1']);
    expect(run.panes[0]!.active).toBe('u1');
  });

  it('same normalized URL in the same scope focuses the existing tab instead of duplicating', () => {
    const first = addRunTab(null, urlTab('u1', 'http://localhost:5173/'))!;
    const second = addRunTab(first, urlTab('u2', 'http://localhost:5173/'))!;
    expect(second.panes[0]!.tabs.map((t) => t.id)).toEqual(['u1']);
    expect(second.panes[0]!.active).toBe('u1');
  });

  it('dedups across panes, not just the target pane', () => {
    const base = addRunTab(null, urlTab('u1', 'http://localhost:5173/'))!;
    const split: RunState = {
      ...base,
      panes: [base.panes[0]!, { id: 'pane-2', tabs: [urlTab('other', 'http://localhost:9000/')], active: 'other' }],
    };
    const result = addRunTab(split, urlTab('u2', 'http://localhost:5173/'), 'pane-2')!;
    expect(tabIdsInRun(result, 'url').sort()).toEqual(['other', 'u1']);
    expect(result.panes[0]!.active).toBe('u1');
  });

  it('same URL with a different scopeKey creates a second tab', () => {
    const first = addRunTab(null, urlTab('u1', 'http://localhost:5173/', 'scope-a'))!;
    const second = addRunTab(first, urlTab('u2', 'http://localhost:5173/', 'scope-b'))!;
    expect(tabIdsInRun(second, 'url').sort()).toEqual(['u1', 'u2']);
    expect(second.panes[0]!.active).toBe('u2');
  });

  it('two URL tabs on the same port with different paths are two tabs', () => {
    const first = addRunTab(null, urlTab('u1', 'http://localhost:5173/a'))!;
    const second = addRunTab(first, urlTab('u2', 'http://localhost:5173/b'))!;
    expect(tabIdsInRun(second, 'url').sort()).toEqual(['u1', 'u2']);
  });
});

describe('releaseRunScope — url tabs', () => {
  it('removes url tabs of the released scope and leaves the others', () => {
    const run: RunState = {
      dir: 'v',
      flex: [1, 1],
      panes: [
        {
          id: 'p1',
          active: 'u2',
          tabs: [urlTab('u1', 'http://localhost:1/', 'scope-a'), urlTab('u2', 'http://localhost:2/', 'scope-b')],
        },
      ],
    };
    const result = releaseRunScope(run, 'scope-a')!;
    expect(result.panes[0]!.tabs.map((t) => t.id)).toEqual(['u2']);
  });
});

describe('kind-parameterized tab id collectors', () => {
  const term = (id: string): RunTab => ({ id, kind: 'terminal', title: id });

  function run(): RunState {
    return {
      dir: 'v',
      flex: [1, 1],
      panes: [
        { id: 'p1', active: 'u1', tabs: [urlTab('u1', 'http://localhost:1/', 'scope-a'), term('t1')] },
        { id: 'p2', active: 't2', tabs: [term('t2'), urlTab('u2', 'http://localhost:2/', 'scope-a')] },
      ],
    };
  }

  it('tabIdsInRun returns only ids of the requested kind', () => {
    expect(tabIdsInRun(run(), 'url').sort()).toEqual(['u1', 'u2']);
    expect(tabIdsInRun(run(), 'terminal').sort()).toEqual(['t1', 't2']);
  });

  it("tabIdsInPane returns only that pane's ids of the requested kind", () => {
    expect(tabIdsInPane(run(), 'p1', 'url')).toEqual(['u1']);
    expect(tabIdsInPane(run(), 'p2', 'terminal')).toEqual(['t2']);
  });

  it('tabIdsForScope returns only ids of the requested kind in that scope', () => {
    expect(tabIdsForScope(run(), 'scope-a', 'url').sort()).toEqual(['u1', 'u2']);
  });
});

describe('retargetUrlTab', () => {
  function run(): RunState {
    return {
      dir: 'v',
      flex: [1, 1],
      panes: [{ id: 'p1', active: 'u1', tabs: [urlTab('u1', 'http://localhost:1/', 'scope-a')] }],
    };
  }

  it('updates the url and title in place, keeping the id', () => {
    const result = retargetUrlTab(run(), 'u1', 'http://localhost:2/', 'localhost:2');
    const tab = result.panes[0]!.tabs[0]!;
    expect(tab.id).toBe('u1');
    expect(tab.url).toBe('http://localhost:2/');
    expect(tab.title).toBe('localhost:2');
  });

  it('returns the same reference when retargeting to the URL it already holds', () => {
    const start = run();
    expect(retargetUrlTab(start, 'u1', 'http://localhost:1/', 'localhost:1')).toBe(start);
  });

  it('activates a sibling tab in the same scope that already holds the target URL, and leaves the source untouched', () => {
    const start: RunState = {
      dir: 'v',
      flex: [1, 1],
      panes: [
        { id: 'p1', active: 'u1', tabs: [urlTab('u1', 'http://localhost:1/', 'scope-a')] },
        { id: 'p2', active: 'u2', tabs: [urlTab('u2', 'http://localhost:2/', 'scope-a')] },
      ],
    };
    const result = retargetUrlTab(start, 'u1', 'http://localhost:2/', 'localhost:2');
    // Source tab u1 unchanged.
    expect(result.panes[0]!.tabs[0]).toEqual(start.panes[0]!.tabs[0]);
    // The holder (u2) is activated in its own pane.
    expect(result.panes[1]!.active).toBe('u2');
  });

  it('a tab in a DIFFERENT scope holding that URL does not block the retarget', () => {
    const start: RunState = {
      dir: 'v',
      flex: [1, 1],
      panes: [
        { id: 'p1', active: 'u1', tabs: [urlTab('u1', 'http://localhost:1/', 'scope-a')] },
        { id: 'p2', active: 'u2', tabs: [urlTab('u2', 'http://localhost:2/', 'scope-b')] },
      ],
    };
    const result = retargetUrlTab(start, 'u1', 'http://localhost:2/', 'localhost:2');
    expect(result.panes[0]!.tabs[0]!.url).toBe('http://localhost:2/');
  });

  it('returns the same reference for an unknown tabId', () => {
    const start = run();
    expect(retargetUrlTab(start, 'nope', 'http://localhost:2/', 'localhost:2')).toBe(start);
  });

  it('returns the same reference for a tab whose kind is not url', () => {
    const start: RunState = {
      dir: 'v',
      flex: [1, 1],
      panes: [{ id: 'p1', active: 't1', tabs: [{ id: 't1', kind: 'terminal', title: 'sh' }] }],
    };
    expect(retargetUrlTab(start, 't1', 'http://localhost:2/', 'localhost:2')).toBe(start);
  });
});
