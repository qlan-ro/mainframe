/**
 * layout/use-surface-drag.ts — pointer drag state machine for the typed-surface
 * engine (Phase 8). Two gestures:
 *   • surface drag  — drag a whole surface header to reposition it
 *     (top-left / top-right / bottom).
 *   • tab drag      — drag a Files tab onto the Run region (center = join as a
 *     tab, edge = split into a pane).
 *
 * The store holds live pointer + drop-zone state; `SurfaceDragLayer` renders the
 * ghost + highlight and commits on drop via the layout store. Drop targets are
 * resolved by hit-testing DOM elements tagged with `data-drop-surface`.
 */
import { create } from 'zustand';
import type { RepositionTarget, SurfaceId } from '@/store/layout';
import { useLayoutStore } from '@/store/layout';
import type { RunDropEdge } from '@/store/run-pane';

export type DropEdge = 'center' | 'left' | 'right' | 'top' | 'bottom';

export interface DropZone {
  /** The surface region under the pointer. */
  surface: SurfaceId;
  edge: DropEdge;
}

/** Minimum pointer displacement (px) before a drag gesture is treated as real. */
const DRAG_THRESHOLD_PX = 4;

interface DragState {
  kind: 'surface' | 'tab' | null;
  /** For a surface drag. */
  surface: SurfaceId | null;
  /** For a tab drag (Files tab id). */
  tabId: string | null;
  pointer: { x: number; y: number };
  /** The pointer position when the drag began (used for the jitter threshold). */
  startPointer: { x: number; y: number };
  dropZone: DropZone | null;
}

interface DragStore extends DragState {
  beginSurfaceDrag: (surface: SurfaceId, e: { clientX: number; clientY: number }) => void;
  beginTabDrag: (tabId: string, e: { clientX: number; clientY: number }) => void;
  setPointer: (x: number, y: number, dropZone: DropZone | null) => void;
  cancel: () => void;
  /** Apply the current dropZone to the layout store + reset. */
  commit: () => void;
}

const IDLE: DragState = {
  kind: null,
  surface: null,
  tabId: null,
  pointer: { x: 0, y: 0 },
  startPointer: { x: 0, y: 0 },
  dropZone: null,
};

/**
 * Map a pointer position within a target rect to a drop edge. The outer
 * `edgeFrac` band on each side is an edge drop; the middle is `center`.
 */
export function computeDropEdge(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
  edgeFrac = 0.25,
): DropEdge {
  const relX = (x - rect.left) / rect.width;
  const relY = (y - rect.top) / rect.height;
  const distLeft = relX;
  const distRight = 1 - relX;
  const distTop = relY;
  const distBottom = 1 - relY;
  const min = Math.min(distLeft, distRight, distTop, distBottom);
  if (min > edgeFrac) return 'center';
  if (min === distLeft) return 'left';
  if (min === distRight) return 'right';
  if (min === distTop) return 'top';
  return 'bottom';
}

/** Reposition target for a surface drag, derived from the hovered drop zone. */
export function repositionTargetFor(zone: DropZone): RepositionTarget {
  if (zone.edge === 'bottom') return 'bottom';
  if (zone.edge === 'right') return 'top-right';
  return 'top-left';
}

export const useSurfaceDragStore = create<DragStore>((set, get) => ({
  ...IDLE,

  beginSurfaceDrag(surface, e) {
    const pt = { x: e.clientX, y: e.clientY };
    set({ ...IDLE, kind: 'surface', surface, pointer: pt, startPointer: pt });
  },

  beginTabDrag(tabId, e) {
    const pt = { x: e.clientX, y: e.clientY };
    set({ ...IDLE, kind: 'tab', tabId, pointer: pt, startPointer: pt });
  },

  setPointer(x, y, dropZone) {
    if (!get().kind) return;
    set({ pointer: { x, y }, dropZone });
  },

  cancel() {
    set({ ...IDLE });
  },

  commit() {
    const { kind, surface, tabId, dropZone, pointer, startPointer } = get();
    const dx = pointer.x - startPointer.x;
    const dy = pointer.y - startPointer.y;
    const moved = Math.sqrt(dx * dx + dy * dy);

    if (moved < DRAG_THRESHOLD_PX) {
      // Jitter: treat as a plain click, no layout change.
      set({ ...IDLE });
      return;
    }

    const layout = useLayoutStore.getState();
    if (kind === 'surface' && surface && dropZone) {
      // Self-center drop is a no-op.
      const isSelfCenter = dropZone.surface === surface && dropZone.edge === 'center';
      if (!isSelfCenter) {
        layout.repositionSurface(surface, repositionTargetFor(dropZone));
      }
    } else if (kind === 'tab' && tabId && dropZone && dropZone.surface === 'run') {
      layout.moveFilesTabToRun(tabId, dropZone.edge as RunDropEdge);
    }
    set({ ...IDLE });
  },
}));
