import { beforeEach, describe, expect, it } from 'vitest';
import { useLayoutStore } from '@/store/layout';
import { useTabsStore } from '@/store/tabs';
import { computeDropEdge, repositionTargetFor, useSurfaceDragStore } from '../use-surface-drag';

const RECT = { left: 0, top: 0, width: 100, height: 100 };

function resetStores() {
  useLayoutStore.setState({
    layout: { top: ['chat'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
    run: null,
    sessions: new Map(),
    activeSessionId: null,
  });
  useTabsStore.setState({ tabs: [], activeTabId: null });
  useSurfaceDragStore.getState().cancel();
}

describe('computeDropEdge', () => {
  it('returns center for a pointer in the middle', () => {
    expect(computeDropEdge(RECT, 50, 50)).toBe('center');
  });

  it('returns the nearest edge near a border', () => {
    expect(computeDropEdge(RECT, 5, 50)).toBe('left');
    expect(computeDropEdge(RECT, 95, 50)).toBe('right');
    expect(computeDropEdge(RECT, 50, 5)).toBe('top');
    expect(computeDropEdge(RECT, 50, 95)).toBe('bottom');
  });
});

describe('repositionTargetFor', () => {
  it('maps edges to reposition targets', () => {
    expect(repositionTargetFor({ surface: 'files', edge: 'bottom' })).toBe('bottom');
    expect(repositionTargetFor({ surface: 'files', edge: 'right' })).toBe('top-right');
    expect(repositionTargetFor({ surface: 'files', edge: 'left' })).toBe('top-left');
    expect(repositionTargetFor({ surface: 'files', edge: 'center' })).toBe('top-left');
  });
});

describe('useSurfaceDragStore', () => {
  beforeEach(resetStores);

  it('beginSurfaceDrag sets the surface drag kind', () => {
    useSurfaceDragStore.getState().beginSurfaceDrag('files', { clientX: 10, clientY: 20 });
    const s = useSurfaceDragStore.getState();
    expect(s.kind).toBe('surface');
    expect(s.surface).toBe('files');
    expect(s.pointer).toEqual({ x: 10, y: 20 });
  });

  it('commit of a surface drag repositions the surface', () => {
    useLayoutStore.getState().toggleSurface('files');
    const drag = useSurfaceDragStore.getState();
    drag.beginSurfaceDrag('files', { clientX: 0, clientY: 0 });
    drag.setPointer(50, 95, { surface: 'files', edge: 'bottom' });
    drag.commit();
    expect(useLayoutStore.getState().layout.bottom).toBe('files');
    expect(useSurfaceDragStore.getState().kind).toBeNull();
  });

  it('commit of a tab drag onto run moves the Files tab into Run', () => {
    useTabsStore.getState().openTab({ kind: 'code', path: '/a.ts', title: 'a.ts' }, { mode: 'permanent' });
    const tabId = useTabsStore.getState().tabs[0]!.id;
    const drag = useSurfaceDragStore.getState();
    drag.beginTabDrag(tabId, { clientX: 0, clientY: 0 });
    drag.setPointer(50, 50, { surface: 'run', edge: 'center' });
    drag.commit();
    expect(useLayoutStore.getState().run?.panes[0]!.tabs.map((t) => t.path)).toEqual(['/a.ts']);
    expect(useTabsStore.getState().tabs).toHaveLength(0);
  });

  it('cancel clears the drag without mutating layout', () => {
    const drag = useSurfaceDragStore.getState();
    drag.beginSurfaceDrag('files', { clientX: 0, clientY: 0 });
    drag.cancel();
    expect(useSurfaceDragStore.getState().kind).toBeNull();
    expect(useLayoutStore.getState().layout.top).toEqual(['chat']);
  });
});
