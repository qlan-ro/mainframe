import { beforeEach, describe, expect, it } from 'vitest';
import { useLayoutStore, type WorkspaceLayout } from '../layout';
import { addRunTab, closePane, closeRunTab, emptyRun, moveTabToRun, type RunTab } from '../run-pane';
import { useTabsStore } from '../tabs';

const FRESH: WorkspaceLayout = { top: ['chat'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } };

function resetStores() {
  useLayoutStore.setState({
    layout: { ...FRESH },
    run: null,
    sessions: new Map(),
    activeSessionId: null,
  });
  useTabsStore.setState({ tabs: [], activeTabId: null });
}

const guest = (id: string): RunTab => ({ id, kind: 'code', title: id });

describe('run-pane reducers', () => {
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

  it('moveTabToRun edge splits Run into two panes', () => {
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

  it('edge-drop onto empty Run places the guest into the single pane (no split)', () => {
    // Run is null — no existing panes with tabs.
    const run = moveTabToRun(null, guest('a'), 'right');
    expect(run.panes).toHaveLength(1);
    expect(run.panes[0]!.tabs.map((t) => t.id)).toEqual(['a']);
  });

  it('edge-drop onto a Run with one empty pane still places guest into that pane', () => {
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

  it('closeRunTab drops an emptied pane and returns null when Run is empty', () => {
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
    s.toggleSurface('files'); // s1 has files
    s.setActiveSession('s2'); // fresh
    expect(useLayoutStore.getState().layout.top).toEqual(['chat']);
    s.setActiveSession('s1'); // restore
    expect(useLayoutStore.getState().layout.top).toContain('files');
  });

  it('persists Run panes per session', () => {
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

describe('layout store — reposition + Files→Run drag', () => {
  beforeEach(resetStores);

  it('repositionSurface moves files from the top row to the bottom strip', () => {
    const s = useLayoutStore.getState();
    s.toggleSurface('files');
    s.repositionSurface('files', 'bottom');
    const { layout } = useLayoutStore.getState();
    expect(layout.bottom).toBe('files');
    expect(layout.top).not.toContain('files');
  });

  it('repositionSurface never sends chat to the bottom strip', () => {
    const s = useLayoutStore.getState();
    s.repositionSurface('chat', 'bottom');
    expect(useLayoutStore.getState().layout.bottom).toBeNull();
  });

  it('moveFilesTabToRun center moves a Files tab into Run as a guest tab', () => {
    const tabs = useTabsStore.getState();
    tabs.openTab({ kind: 'code', path: '/a.ts', title: 'a.ts' }, { mode: 'permanent' });
    const tabId = useTabsStore.getState().tabs[0]!.id;

    useLayoutStore.getState().moveFilesTabToRun(tabId, 'center');

    const { layout, run } = useLayoutStore.getState();
    expect(run?.panes[0]!.tabs.map((t) => t.path)).toEqual(['/a.ts']);
    expect(layout.top.includes('run') || layout.bottom === 'run').toBe(true);
    expect(useTabsStore.getState().tabs).toHaveLength(0); // removed from Files
  });

  it('moveFilesTabToRun edge splits Run into two panes', () => {
    const tabs = useTabsStore.getState();
    tabs.openTab({ kind: 'code', path: '/a.ts', title: 'a.ts' }, { mode: 'permanent' });
    tabs.openTab({ kind: 'code', path: '/b.ts', title: 'b.ts' }, { mode: 'permanent' });
    const first = useTabsStore.getState().tabs[0]!.id;
    const second = useTabsStore.getState().tabs[1]!.id;

    const s = useLayoutStore.getState();
    s.moveFilesTabToRun(first, 'center');
    s.moveFilesTabToRun(second, 'right');

    expect(useLayoutStore.getState().run?.panes).toHaveLength(2);
  });

  it('closePane that empties Run removes the Run surface from the layout', () => {
    const s = useLayoutStore.getState();
    s.addRunTab(guest('a'));
    expect(useLayoutStore.getState().run).not.toBeNull();
    const paneId = useLayoutStore.getState().run!.panes[0]!.id;
    s.closePane(paneId);
    const { layout, run } = useLayoutStore.getState();
    expect(run).toBeNull();
    expect(layout.top.includes('run') || layout.bottom === 'run').toBe(false);
  });
});

describe('layout store — existing invariants still hold', () => {
  beforeEach(resetStores);

  it('chat is never removable', () => {
    useLayoutStore.getState().toggleSurface('chat');
    expect(useLayoutStore.getState().layout.top).toContain('chat');
  });

  it('Cmd-1/2/3 style toggle still adds/removes files', () => {
    const s = useLayoutStore.getState();
    s.toggleSurface('files');
    expect(useLayoutStore.getState().layout.top).toContain('files');
    s.toggleSurface('files');
    expect(useLayoutStore.getState().layout.top).not.toContain('files');
  });
});
