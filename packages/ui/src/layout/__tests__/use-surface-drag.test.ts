import { beforeEach, describe, expect, it } from 'vitest';
import { useLayoutStore } from '@/store/layout';
import { computeDropEdge, repositionTargetFor, useSurfaceDragStore } from '../use-surface-drag';

const RECT = { left: 0, top: 0, width: 100, height: 100 };

function resetStores() {
  useLayoutStore.setState({
    layout: { top: ['chat'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
    run: null,
    sessions: new Map(),
    activeSessionId: null,
  });
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
    expect(repositionTargetFor({ surface: 'workspace', edge: 'bottom' })).toBe('bottom');
    expect(repositionTargetFor({ surface: 'workspace', edge: 'right' })).toBe('top-right');
    expect(repositionTargetFor({ surface: 'workspace', edge: 'left' })).toBe('top-left');
    expect(repositionTargetFor({ surface: 'workspace', edge: 'center' })).toBe('top-left');
  });
});

describe('useSurfaceDragStore', () => {
  beforeEach(resetStores);

  it('beginSurfaceDrag sets the surface drag kind', () => {
    useSurfaceDragStore.getState().beginSurfaceDrag('workspace', { clientX: 10, clientY: 20 });
    const s = useSurfaceDragStore.getState();
    expect(s.kind).toBe('surface');
    expect(s.surface).toBe('workspace');
    expect(s.pointer).toEqual({ x: 10, y: 20 });
  });

  it('commit of a surface drag repositions the surface', () => {
    useLayoutStore.getState().toggleSurface('workspace');
    const drag = useSurfaceDragStore.getState();
    drag.beginSurfaceDrag('workspace', { clientX: 0, clientY: 0 });
    drag.setPointer(50, 95, { surface: 'workspace', edge: 'bottom' });
    drag.commit();
    expect(useLayoutStore.getState().layout.bottom).toBe('workspace');
    expect(useSurfaceDragStore.getState().kind).toBeNull();
  });

  it('commit of a tab drag on a workspace edge splits the workspace', () => {
    const layout = useLayoutStore.getState();
    layout.openFileTab({ kind: 'code', path: '/a.ts', title: 'a.ts' }, 'permanent');
    const tabId = layout.openFileTab({ kind: 'code', path: '/b.ts', title: 'b.ts' }, 'permanent');

    const drag = useSurfaceDragStore.getState();
    drag.beginTabDrag(tabId, { clientX: 0, clientY: 0 });
    drag.setPointer(95, 50, { surface: 'workspace', edge: 'right' });
    drag.commit();

    const run = useLayoutStore.getState().run!;
    expect(run.panes.map((p) => p.tabs.map((t) => t.path))).toEqual([['/a.ts'], ['/b.ts']]);
  });

  it('a tab drag onto the CHAT surface is ignored — cross-surface adoption is gone', () => {
    const tabId = useLayoutStore.getState().openFileTab({ kind: 'code', path: '/a.ts', title: 'a.ts' }, 'permanent');
    const before = useLayoutStore.getState().run;

    const drag = useSurfaceDragStore.getState();
    drag.beginTabDrag(tabId, { clientX: 0, clientY: 0 });
    drag.setPointer(50, 50, { surface: 'chat', edge: 'center' });
    drag.commit();

    expect(useLayoutStore.getState().run).toBe(before);
  });

  it('cancel clears the drag without mutating layout', () => {
    const drag = useSurfaceDragStore.getState();
    drag.beginSurfaceDrag('workspace', { clientX: 0, clientY: 0 });
    drag.cancel();
    expect(useSurfaceDragStore.getState().kind).toBeNull();
    expect(useLayoutStore.getState().layout.top).toEqual(['chat']);
  });

  it('commit with <4px movement is a no-op (jitter threshold)', () => {
    useLayoutStore.getState().toggleSurface('workspace');
    const drag = useSurfaceDragStore.getState();
    // Begin at (100, 100), move only 3px diagonally — below the 4px threshold.
    drag.beginSurfaceDrag('workspace', { clientX: 100, clientY: 100 });
    drag.setPointer(102, 102, { surface: 'workspace', edge: 'bottom' });
    drag.commit();
    // Layout must be unchanged — files stays in top, not bottom.
    const { layout } = useLayoutStore.getState();
    expect(layout.bottom).toBeNull();
    expect(layout.top).toContain('workspace');
    expect(useSurfaceDragStore.getState().kind).toBeNull();
  });

  it('commit with ≥4px movement commits the reposition', () => {
    useLayoutStore.getState().toggleSurface('workspace');
    const drag = useSurfaceDragStore.getState();
    drag.beginSurfaceDrag('workspace', { clientX: 0, clientY: 0 });
    drag.setPointer(0, 95, { surface: 'workspace', edge: 'bottom' });
    drag.commit();
    expect(useLayoutStore.getState().layout.bottom).toBe('workspace');
  });

  it('self-center surface drop is a no-op', () => {
    useLayoutStore.getState().toggleSurface('workspace');
    const before = useLayoutStore.getState().layout;
    const drag = useSurfaceDragStore.getState();
    drag.beginSurfaceDrag('workspace', { clientX: 0, clientY: 0 });
    drag.setPointer(10, 10, { surface: 'workspace', edge: 'center' });
    drag.commit();
    expect(useLayoutStore.getState().layout).toEqual(before);
    expect(useSurfaceDragStore.getState().kind).toBeNull();
  });
});
