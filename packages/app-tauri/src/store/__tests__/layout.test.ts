import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceLayout } from '../layout';
import { layoutCanSplit, useLayoutStore } from '../layout';

const FRESH: WorkspaceLayout = {
  top: ['chat'],
  bottom: null,
  topFlex: {},
  vFlex: { top: 1, bottom: 0.4 },
};

function store() {
  return useLayoutStore.getState();
}

function isActive(surface: string) {
  const { layout } = store();
  return layout.top.includes(surface as never) || layout.bottom === surface;
}

describe('layout store', () => {
  beforeEach(() => {
    useLayoutStore.setState({ layout: { ...FRESH } });
  });

  it('default state has only chat active', () => {
    expect(isActive('chat')).toBe(true);
    expect(isActive('files')).toBe(false);
    expect(isActive('run')).toBe(false);
  });

  it('toggleSurface turns an inactive surface on (placed in top row)', () => {
    store().toggleSurface('files');
    expect(isActive('files')).toBe(true);
    expect(store().layout.top).toContain('files');
  });

  it('chat is the permanent floor — toggleSurface("chat") is always a no-op', () => {
    // single surface: still no-op
    store().toggleSurface('chat');
    expect(isActive('chat')).toBe(true);

    // multiple surfaces: still no-op
    store().toggleSurface('files');
    store().toggleSurface('chat');
    expect(isActive('chat')).toBe(true);
  });

  it('files can be toggled off when active', () => {
    store().toggleSurface('files');
    store().toggleSurface('files');
    expect(isActive('files')).toBe(false);
    expect(isActive('chat')).toBe(true);
  });

  it('run can be toggled off when active', () => {
    store().toggleSurface('run');
    store().toggleSurface('run');
    expect(isActive('run')).toBe(false);
    expect(isActive('chat')).toBe(true);
  });

  it('3rd surface placed in bottom strip when top row is full', () => {
    store().toggleSurface('files');
    store().toggleSurface('run');
    const { layout } = store();
    expect(layout.top.length).toBe(2);
    expect(layout.bottom).toBe('run');
  });

  it('bottom strip promoted to top row when a top surface is removed', () => {
    store().toggleSurface('files');
    store().toggleSurface('run'); // run → bottom
    store().toggleSurface('files'); // remove files → run promoted to top
    const { layout } = store();
    expect(layout.bottom).toBeNull();
    expect(layout.top).toContain('run');
  });

  it('setTopFrac updates flex fractions clamped 0.18–0.82', () => {
    store().toggleSurface('files');
    store().setTopFrac(0.6);
    const { layout } = store();
    expect(layout.topFlex['chat']).toBeCloseTo(0.6);
    expect(layout.topFlex['files']).toBeCloseTo(0.4);
  });

  it('setTopFrac clamps below 0.18 to 0.18', () => {
    store().toggleSurface('files');
    store().setTopFrac(0.05);
    expect(store().layout.topFlex['chat']).toBeCloseTo(0.18);
  });

  it('setVFrac updates vertical flex fractions', () => {
    store().toggleSurface('files');
    store().toggleSurface('run');
    store().setVFrac(0.7);
    const { layout } = store();
    expect(layout.vFlex.top).toBeCloseTo(0.7);
    expect(layout.vFlex.bottom).toBeCloseTo(0.3);
  });

  describe('layoutCanSplit', () => {
    it('returns true when only chat is active', () => {
      expect(layoutCanSplit(store().layout)).toBe(true);
    });

    it('returns true when files is active but run is not', () => {
      store().toggleSurface('files');
      expect(layoutCanSplit(store().layout)).toBe(true);
    });

    it('returns false when both files and run are active', () => {
      store().toggleSurface('files');
      store().toggleSurface('run');
      expect(layoutCanSplit(store().layout)).toBe(false);
    });
  });

  describe('splitSurface', () => {
    it('"v" adds the next missing surface to the top row', () => {
      store().splitSurface('v');
      const { layout } = store();
      expect(layout.top).toContain('files');
      expect(layout.bottom).toBeNull();
    });

    it('"h" adds the next missing surface to the bottom strip', () => {
      store().splitSurface('h');
      const { layout } = store();
      expect(layout.bottom).toBe('files');
      expect(layout.top).toEqual(['chat']);
    });

    it('"h" does nothing when bottom strip is already occupied', () => {
      store().splitSurface('h'); // files → bottom
      store().splitSurface('h'); // run → nowhere (bottom occupied)
      const { layout } = store();
      expect(layout.bottom).toBe('files');
      expect(layout.top).toEqual(['chat']);
    });

    it('"v" twice: first goes to top row, second goes to bottom (top is full)', () => {
      store().splitSurface('v'); // files → top row
      store().splitSurface('v'); // run → top is full → bottom
      const { layout } = store();
      expect(layout.bottom).toBe('run');
    });

    it('does nothing when both files and run are already active', () => {
      store().toggleSurface('files');
      store().toggleSurface('run');
      const before = store().layout;
      store().splitSurface('v');
      expect(store().layout).toEqual(before);
    });
  });
});
