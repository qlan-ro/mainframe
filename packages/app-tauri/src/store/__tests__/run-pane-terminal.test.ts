import { describe, expect, it } from 'vitest';
import { addRunTab, moveTabToRun, terminalIdsInPane, terminalIdsInRun, type RunTab } from '../run-pane';
import { useLayoutStore, type SurfaceId } from '../layout';

const tab = (id: string): RunTab => ({ id, kind: 'terminal', title: id });

describe('addRunTab pane targeting', () => {
  it('defaults to the first pane when no paneId is given (back-compat)', () => {
    const run = addRunTab(null, tab('a'));
    expect(run!.panes[0]!.tabs.map((t) => t.id)).toEqual(['a']);
  });

  it('appends to the targeted pane when paneId is given', () => {
    // Build a two-pane Run, then target the second pane.
    const two = moveTabToRun(addRunTab(null, tab('a'))!, tab('b'), 'right');
    const secondPaneId = two.panes[1]!.id;
    const next = addRunTab(two, tab('c'), secondPaneId);
    expect(next!.panes[1]!.tabs.map((t) => t.id)).toEqual(['b', 'c']);
    expect(next!.panes[1]!.active).toBe('c');
    expect(next!.panes[0]!.tabs.map((t) => t.id)).toEqual(['a']); // first pane untouched
  });

  it('returns null (no-op) when an explicit paneId is gone on a non-null run', () => {
    // The pane was closed between intent and add — do NOT dump into pane 0.
    const start = addRunTab(null, tab('a'));
    const next = addRunTab(start, tab('b'), 'pane-that-was-closed');
    expect(next).toBeNull(); // null is the no-op signal
    expect(start!.panes[0]!.tabs.map((t) => t.id)).toEqual(['a']); // 'b' was NOT added anywhere
  });

  it('returns null (no-op) when run is null and an explicit paneId is given', () => {
    // The whole Run surface was torn down to null during the async create gap.
    // A fresh emptyRun() has no such pane, so this is still a no-op — and the
    // null signal (not reference equality) is what catches it.
    const next = addRunTab(null, tab('b'), 'pane-gone');
    expect(next).toBeNull();
  });
});

describe('addRunTab action (layout store)', () => {
  const emptyLayout = () => ({
    layout: { top: ['chat' as SurfaceId], bottom: null as null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
    run: null,
    sessions: new Map(),
    activeSessionId: null,
  });

  it('reports false and writes nothing when run is null and the paneId is gone', () => {
    useLayoutStore.setState(emptyLayout());
    const added = useLayoutStore.getState().addRunTab({ id: 't1', kind: 'terminal', title: 'Terminal' }, 'pane-gone');
    expect(added).toBe(false);
    const { layout, run } = useLayoutStore.getState();
    expect(run).toBeNull(); // no spurious empty Run surface committed
    expect(layout.top).not.toContain('run'); // Run was NOT placed in the layout
    expect(layout.bottom).not.toBe('run');
  });

  it('reports true and commits a Run state on the first-pane default path', () => {
    useLayoutStore.setState(emptyLayout());
    const added = useLayoutStore.getState().addRunTab({ id: 't2', kind: 'terminal', title: 'Terminal' });
    expect(added).toBe(true);
    const { layout, run } = useLayoutStore.getState();
    expect(run!.panes[0]!.tabs.map((t) => t.id)).toEqual(['t2']);
    expect(layout.top.includes('run') || layout.bottom === 'run').toBe(true); // Run placed
  });
});

describe('terminal id collectors', () => {
  const term = (id: string): RunTab => ({ id, kind: 'terminal', title: id });
  const code = (id: string): RunTab => ({ id, kind: 'code', title: id });

  it('terminalIdsInRun returns every terminal tab id across panes', () => {
    const run = {
      dir: 'v' as const,
      flex: [1, 1],
      panes: [
        { id: 'p1', tabs: [term('t1'), code('c1')], active: 't1' },
        { id: 'p2', tabs: [term('t2')], active: 't2' },
      ],
    };
    expect(terminalIdsInRun(run).sort()).toEqual(['t1', 't2']);
  });

  it('terminalIdsInPane returns only that pane terminal ids', () => {
    const run = {
      dir: 'v' as const,
      flex: [1, 1],
      panes: [
        { id: 'p1', tabs: [term('t1'), code('c1')], active: 't1' },
        { id: 'p2', tabs: [term('t2')], active: 't2' },
      ],
    };
    expect(terminalIdsInPane(run, 'p1')).toEqual(['t1']);
    expect(terminalIdsInPane(run, 'p2')).toEqual(['t2']);
    expect(terminalIdsInPane(run, 'nope')).toEqual([]);
  });

  it('terminalIdsInRun on null is empty', () => {
    expect(terminalIdsInRun(null)).toEqual([]);
  });
});
