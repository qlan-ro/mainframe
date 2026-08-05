import { beforeEach, describe, expect, it } from 'vitest';
import { useLayoutStore, type WorkspaceLayout } from '../layout';
import { addRunTab, closePane, closeRunTab, emptyRun, moveTabToRun, type RunTab } from '../run-pane';

const FRESH: WorkspaceLayout = { top: ['chat'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } };

function resetStores() {
  useLayoutStore.setState({
    layout: { ...FRESH },
    run: null,
    sessions: new Map(),
    activeSessionId: null,
  });
}

const guest = (id: string): RunTab => ({ id, kind: 'code', title: id });

describe('workspace-pane reducers', () => {
  it('emptyRun has one empty pane', () => {
    const run = emptyRun();
    expect(run.panes).toHaveLength(1);
    expect(run.panes[0]!.tabs).toEqual([]);
  });

  it('addRunTab appends to the first pane and focuses it', () => {
    const run = addRunTab(null, guest('a'))!;
    expect(run.panes[0]!.tabs.map((t) => t.id)).toEqual(['a']);
    expect(run.panes[0]!.active).toBe('a');
  });

  it('moveTabToRun center joins the existing pane as a tab', () => {
    const run = moveTabToRun(addRunTab(null, guest('a')), guest('b'), 'center');
    expect(run.panes).toHaveLength(1);
    expect(run.panes[0]!.tabs.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('moveTabToRun edge splits the workspace into two panes', () => {
    const run = moveTabToRun(addRunTab(null, guest('a')), guest('b'), 'right');
    expect(run.panes).toHaveLength(2);
    expect(run.dir).toBe('v');
    expect(run.panes[1]!.tabs.map((t) => t.id)).toEqual(['b']);
  });

  it('moveTabToRun left/top places the new pane first; bottom uses a horizontal split', () => {
    const left = moveTabToRun(addRunTab(null, guest('a')), guest('b'), 'left');
    expect(left.panes[0]!.tabs.map((t) => t.id)).toEqual(['b']);
    const bottom = moveTabToRun(addRunTab(null, guest('a')), guest('b'), 'bottom');
    expect(bottom.dir).toBe('h');
  });

  it('moveTabToRun edge while already split joins as a tab (caps at 2 panes)', () => {
    const two = moveTabToRun(addRunTab(null, guest('a')), guest('b'), 'right');
    const three = moveTabToRun(two, guest('c'), 'left');
    expect(three.panes).toHaveLength(2);
    expect(three.panes[0]!.tabs.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('edge-drop onto an empty workspace places the tab into the single pane (no split)', () => {
    // run is null — no existing panes with tabs.
    const run = moveTabToRun(null, guest('a'), 'right');
    expect(run.panes).toHaveLength(1);
    expect(run.panes[0]!.tabs.map((t) => t.id)).toEqual(['a']);
  });

  it('edge-drop onto a workspace with one empty pane still places the tab into that pane', () => {
    // emptyRun() has 1 pane with 0 tabs.
    const base = emptyRun();
    const run = moveTabToRun(base, guest('a'), 'left');
    expect(run.panes).toHaveLength(1);
    expect(run.panes[0]!.tabs.map((t) => t.id)).toEqual(['a']);
  });

  it('closePane returns null when the last pane is removed', () => {
    const run = addRunTab(null, guest('a'))!;
    expect(closePane(run, run.panes[0]!.id)).toBeNull();
  });

  it('closeRunTab drops an emptied pane and returns null when the workspace is empty', () => {
    const run = addRunTab(null, guest('a'))!;
    expect(closeRunTab(run, run.panes[0]!.id, 'a')).toBeNull();
  });
});

describe('layout store — per-session workspaces', () => {
  beforeEach(resetStores);

  it('setActiveSession seeds a chat-only workspace', () => {
    useLayoutStore.getState().setActiveSession('s1');
    const { layout, activeSessionId } = useLayoutStore.getState();
    expect(activeSessionId).toBe('s1');
    expect(layout.top).toEqual(['chat']);
    expect(layout.bottom).toBeNull();
  });

  it('remembers each session layout across a switch away and back', () => {
    const s = useLayoutStore.getState();
    s.setActiveSession('s1');
    s.toggleSurface('workspace'); // s1 has the workspace
    s.setActiveSession('s2'); // fresh
    expect(useLayoutStore.getState().layout.top).toEqual(['chat']);
    s.setActiveSession('s1'); // restore
    expect(useLayoutStore.getState().layout.top).toContain('workspace');
  });

  it('persists workspace panes per session', () => {
    const s = useLayoutStore.getState();
    s.setActiveSession('s1');
    s.addRunTab(guest('a'));
    expect(useLayoutStore.getState().run?.panes[0]!.tabs).toHaveLength(1);
    s.setActiveSession('s2');
    expect(useLayoutStore.getState().run).toBeNull();
    s.setActiveSession('s1');
    expect(useLayoutStore.getState().run?.panes[0]!.tabs.map((t) => t.id)).toEqual(['a']);
  });
});

describe('layout store — reposition + in-workspace tab drag', () => {
  beforeEach(resetStores);

  it('repositionSurface moves the workspace from the top row to the bottom strip', () => {
    const s = useLayoutStore.getState();
    s.toggleSurface('workspace');
    s.repositionSurface('workspace', 'bottom');
    const { layout } = useLayoutStore.getState();
    expect(layout.bottom).toBe('workspace');
    expect(layout.top).not.toContain('workspace');
  });

  it('repositionSurface never sends chat to the bottom strip', () => {
    const s = useLayoutStore.getState();
    s.repositionSurface('chat', 'bottom');
    expect(useLayoutStore.getState().layout.bottom).toBeNull();
  });

  it('openFileTab opens a file into the workspace and lights the surface', () => {
    const tabId = useLayoutStore.getState().openFileTab({ kind: 'code', path: '/a.ts', title: 'a.ts' }, 'preview');

    const { layout, run } = useLayoutStore.getState();
    expect(run?.panes[0]!.tabs.map((t) => t.path)).toEqual(['/a.ts']);
    expect(run?.panes[0]!.active).toBe(tabId);
    expect(layout.top.includes('workspace') || layout.bottom === 'workspace').toBe(true);
  });

  it('moveTabToPaneEdge splits the workspace into two panes', () => {
    const s = useLayoutStore.getState();
    s.openFileTab({ kind: 'code', path: '/a.ts', title: 'a.ts' }, 'permanent');
    const second = s.openFileTab({ kind: 'code', path: '/b.ts', title: 'b.ts' }, 'permanent');

    s.moveTabToPaneEdge(second, 'right');

    expect(useLayoutStore.getState().run?.panes).toHaveLength(2);
  });

  it('closePane that empties the workspace removes the surface from the layout', () => {
    const s = useLayoutStore.getState();
    s.addRunTab(guest('a'));
    expect(useLayoutStore.getState().run).not.toBeNull();
    const paneId = useLayoutStore.getState().run!.panes[0]!.id;
    s.closePane(paneId);
    const { layout, run } = useLayoutStore.getState();
    expect(run).toBeNull();
    expect(layout.top.includes('workspace') || layout.bottom === 'workspace').toBe(false);
  });
});

describe('layout store — existing invariants still hold', () => {
  beforeEach(resetStores);

  it('chat is never removable while it is the only lit surface', () => {
    useLayoutStore.getState().toggleSurface('chat');
    expect(useLayoutStore.getState().layout.top).toContain('chat');
  });

  it('Cmd-2 style toggle adds and removes the workspace', () => {
    const s = useLayoutStore.getState();
    s.toggleSurface('workspace');
    expect(useLayoutStore.getState().layout.top).toContain('workspace');
    s.toggleSurface('workspace');
    expect(useLayoutStore.getState().layout.top).not.toContain('workspace');
  });
});
