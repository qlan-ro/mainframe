import { beforeEach, describe, expect, it } from 'vitest';
import type { SurfaceId, WorkspaceLayout } from '../layout';
import type { RunTab } from '../run-pane';
import { useActiveBasesStore } from '../active-bases-store';
import { isSurfaceFloor, useLayoutStore } from '../layout';

const FRESH: WorkspaceLayout = {
  top: ['chat'],
  topFlex: {},
};

function store() {
  return useLayoutStore.getState();
}

function isActive(surface: SurfaceId) {
  const { layout } = store();
  return layout.top.includes(surface);
}

describe('layout store', () => {
  beforeEach(() => {
    useLayoutStore.setState({ layout: { ...FRESH }, run: null });
  });

  it('default state has only chat active', () => {
    expect(isActive('chat')).toBe(true);
    expect(isActive('workspace')).toBe(false);
  });

  it('toggleSurface turns an inactive surface on (placed in top row)', () => {
    store().toggleSurface('workspace');
    expect(isActive('workspace')).toBe(true);
    expect(store().layout.top).toContain('workspace');
  });

  it('dynamic floor: the only lit surface (chat) cannot be hidden', () => {
    expect(isSurfaceFloor(store().layout, 'chat')).toBe(true);
    store().toggleSurface('chat'); // no-op — it is the floor
    expect(isActive('chat')).toBe(true);
  });

  it('chat CAN be hidden once the workspace is lit', () => {
    store().toggleSurface('workspace'); // chat + workspace lit → chat no longer the floor
    expect(isSurfaceFloor(store().layout, 'chat')).toBe(false);
    store().toggleSurface('chat');
    expect(isActive('chat')).toBe(false);
    expect(isActive('workspace')).toBe(true);
  });

  it('the last remaining surface becomes the floor and cannot be hidden', () => {
    store().toggleSurface('workspace');
    store().toggleSurface('chat'); // hide chat → workspace alone
    expect(isSurfaceFloor(store().layout, 'workspace')).toBe(true);
    store().toggleSurface('workspace'); // no-op — the workspace is now the floor
    expect(isActive('workspace')).toBe(true);
  });

  it('the workspace can be toggled off when active', () => {
    store().toggleSurface('workspace');
    store().toggleSurface('workspace');
    expect(isActive('workspace')).toBe(false);
    expect(isActive('chat')).toBe(true);
  });

  // Hiding is not closing: the panes survive so re-showing returns the tabs.
  it('toggling the workspace off then on preserves its panes', () => {
    store().addRunTab({ id: 't1', kind: 'terminal', title: 'zsh' });
    store().toggleSurface('workspace');
    expect(isActive('workspace')).toBe(false);
    expect(store().run?.panes[0]!.tabs.map((t) => t.id)).toEqual(['t1']);

    store().toggleSurface('workspace');
    expect(isActive('workspace')).toBe(true);
    expect(store().run?.panes[0]!.tabs.map((t) => t.id)).toEqual(['t1']);
  });

  it('setTopFrac updates flex fractions clamped 0.18–0.82', () => {
    store().toggleSurface('workspace');
    store().setTopFrac(0.6);
    const { layout } = store();
    expect(layout.topFlex['chat']).toBeCloseTo(0.6);
    expect(layout.topFlex['workspace']).toBeCloseTo(0.4);
  });

  it('setTopFrac clamps below 0.18 to 0.18', () => {
    store().toggleSurface('workspace');
    store().setTopFrac(0.05);
    expect(store().layout.topFlex['chat']).toBeCloseTo(0.18);
  });

  it('keeps chat left of the workspace, whichever was lit last', () => {
    store().toggleSurface('workspace');
    store().toggleSurface('chat');
    store().toggleSurface('chat');
    expect(store().layout.top).toEqual(['chat', 'workspace']);
  });
});

describe('closing tabs (W5)', () => {
  beforeEach(() => {
    useLayoutStore.setState({ layout: { ...FRESH }, run: null, sessions: new Map(), activeSessionId: null });
    useActiveBasesStore.setState({ bases: {}, scopeKey: 'proj:/a' });
  });

  const open = (id: string, over: Partial<RunTab> = {}) =>
    store().addRunTab({ id, kind: 'code', title: id, scopeKey: 'proj:/a', ...over });
  const close = (id: string) => store().closeRunTab(store().run!.panes[0]!.id, id);

  it('collapses the workspace with the last tab, and not before', () => {
    open('a');
    open('b');
    close('a');
    expect(isActive('workspace')).toBe(true);
    close('b');
    expect(isActive('workspace')).toBe(false);
    expect(store().run).toBeNull();
  });

  it('collapses with the last VISIBLE tab: one of another worktree stays, unseen', () => {
    open('other', { scopeKey: 'proj:/b' });
    open('a');
    close('a');
    expect(isActive('workspace')).toBe(false);
    expect(store().run!.panes[0]!.tabs.map((t) => t.id)).toEqual(['other']);
  });

  it('stays open while a chat tab is left, which every scope shows', () => {
    open('chat', { kind: 'chat', chatId: 'fork-1', role: 'fork', scopeKey: undefined });
    open('a');
    close('a');
    expect(isActive('workspace')).toBe(true);
    close('chat');
    expect(isActive('workspace')).toBe(false);
  });

  it('brings chat back when the workspace was alone', () => {
    open('a');
    store().toggleSurface('chat');
    close('a');
    expect(store().layout.top).toEqual(['chat']);
  });

  it('can be opened again with nothing in it', () => {
    open('a');
    close('a');
    store().toggleSurface('workspace');
    expect(isActive('workspace')).toBe(true);
  });
});

describe('addSessionTab', () => {
  const tab: RunTab = { id: 'chat-b', kind: 'chat', title: 'B', chatId: 'b', role: 'session' };

  beforeEach(() => {
    useLayoutStore.setState({ layout: { ...FRESH }, run: null, sessions: new Map(), activeSessionId: 'a' });
  });

  it('adds to the active session, on screen', () => {
    store().addSessionTab('a', tab);
    expect(store().layout.top).toEqual(['chat', 'workspace']);
    expect(store().run!.panes[0]!.active).toBe('chat-b');
  });

  it('adds to a session that is not on screen, and leaves the one that is alone', () => {
    store().addSessionTab('c', tab);
    expect(store().layout.top).toEqual(['chat']);
    expect(store().run).toBeNull();

    store().setActiveSession('c');
    expect(store().layout.top).toEqual(['chat', 'workspace']);
    expect(store().run!.panes[0]!.tabs.map((t) => t.chatId)).toEqual(['b']);
  });

  it('opens a chat once', () => {
    store().addSessionTab('c', tab);
    store().addSessionTab('c', { ...tab, id: 'again' });
    store().setActiveSession('c');
    expect(store().run!.panes[0]!.tabs.map((t) => t.id)).toEqual(['chat-b']);
  });
});
