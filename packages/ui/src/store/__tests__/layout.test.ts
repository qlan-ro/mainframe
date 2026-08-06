import { beforeEach, describe, expect, it } from 'vitest';
import type { SurfaceId, WorkspaceLayout } from '../layout';
import { isSurfaceFloor, layoutCanSplit, litSurfaceCount, useLayoutStore } from '../layout';

const FRESH: WorkspaceLayout = {
  top: ['chat'],
  bottom: null,
  topFlex: {},
  vFlex: { top: 1, bottom: 0.4 },
};

function store() {
  return useLayoutStore.getState();
}

function isActive(surface: SurfaceId) {
  const { layout } = store();
  return layout.top.includes(surface) || layout.bottom === surface;
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

  it('litSurfaceCount counts top + bottom surfaces', () => {
    expect(litSurfaceCount(store().layout)).toBe(1);
    store().toggleSurface('workspace');
    expect(litSurfaceCount(store().layout)).toBe(2);
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

  it('bottom strip promoted to top row when the top row loses a surface', () => {
    store().splitSurface('h'); // workspace → bottom strip
    expect(store().layout.bottom).toBe('workspace');
    store().toggleSurface('chat'); // remove chat → workspace promoted to top
    const { layout } = store();
    expect(layout.bottom).toBeNull();
    expect(layout.top).toEqual(['workspace']);
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

  it('setVFrac updates vertical flex fractions', () => {
    store().splitSurface('h');
    store().setVFrac(0.7);
    const { layout } = store();
    expect(layout.vFlex.top).toBeCloseTo(0.7);
    expect(layout.vFlex.bottom).toBeCloseTo(0.3);
  });

  describe('layoutCanSplit', () => {
    it('returns true when only chat is active', () => {
      expect(layoutCanSplit(store().layout)).toBe(true);
    });

    it('returns false once the workspace is placed in the top row', () => {
      store().toggleSurface('workspace');
      expect(layoutCanSplit(store().layout)).toBe(false);
    });

    it('returns false once the workspace is placed in the bottom strip', () => {
      store().splitSurface('h');
      expect(layoutCanSplit(store().layout)).toBe(false);
    });
  });

  describe('splitSurface', () => {
    it('"v" adds the workspace to the top row', () => {
      store().splitSurface('v');
      const { layout } = store();
      expect(layout.top).toEqual(['chat', 'workspace']);
      expect(layout.bottom).toBeNull();
    });

    it('"h" adds the workspace to the bottom strip', () => {
      store().splitSurface('h');
      const { layout } = store();
      expect(layout.bottom).toBe('workspace');
      expect(layout.top).toEqual(['chat']);
    });

    it('does nothing when the workspace is already lit', () => {
      store().toggleSurface('workspace');
      const before = store().layout;
      store().splitSurface('v');
      expect(store().layout).toEqual(before);
    });
  });
});
