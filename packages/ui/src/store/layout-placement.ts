/**
 * store/layout-placement.ts — pure workspace-layout types and placement
 * helpers (mirrors 04-engine.jsx placeInLayout / removeSurface). Split out of
 * `layout.ts` (#281 Task 32): these touch no store state, unlike the tab
 * mutators, which close over `get()`/`writeWorkspace` and would need an
 * injection shape to extract for a much smaller line-count win.
 *
 * Two surfaces, since Files and Run merged: chat and the workspace. The shape
 * below still carries a top row + a bottom slot + flex weights — surface
 * PLACEMENT is deliberately unchanged by the merge (see docs/plans).
 */

export type SurfaceId = 'chat' | 'workspace';

/** Where a dragged surface lands when repositioned. */
export type RepositionTarget = 'top-left' | 'top-right' | 'bottom';

export interface WorkspaceLayout {
  /** 1 or 2 surfaces in the main horizontal row. Chat always lives here. */
  top: SurfaceId[];
  /** Optional single surface in a strip below the top row. */
  bottom: SurfaceId | null;
  /** Flex weights for the top-row surfaces (default 1 each, set by drag). */
  topFlex: Partial<Record<SurfaceId, number>>;
  /** Flex weights for top-row vs bottom-strip (set by drag). */
  vFlex: { top: number; bottom: number };
}

export function insertTop(top: SurfaceId[], s: SurfaceId): SurfaceId[] {
  if (s === 'chat') return ['chat', ...top.filter((x) => x !== 'chat')];
  // Non-chat: keep chat leftmost, append new surface after existing ones.
  return [...top, s];
}

export function placeInLayout(layout: WorkspaceLayout, s: SurfaceId): WorkspaceLayout {
  const { top, bottom } = layout;
  if (top.includes(s) || bottom === s) return layout;

  const newTop = [...top];
  let newBottom = bottom;

  if (s === 'chat') {
    // Demote the most-recent top surface to bottom if the row is full.
    if (newTop.length >= 2 && !newBottom) newBottom = newTop.pop()!;
    return { ...layout, top: insertTop(newTop, 'chat'), bottom: newBottom };
  }

  if (newTop.length < 2) return { ...layout, top: insertTop(newTop, s) };
  if (!newBottom) return { ...layout, bottom: s };
  return layout; // all 3 slots already filled
}

export function removeSurface(layout: WorkspaceLayout, s: SurfaceId): WorkspaceLayout {
  let top = layout.top.filter((x) => x !== s);
  let bottom = layout.bottom === s ? null : layout.bottom;

  // Compact: never leave a lone bottom strip — promote it to the top row.
  if (bottom && top.length < 2) {
    top = insertTop(top, bottom);
    bottom = null;
  }

  // Floor: never zero surfaces — restore chat.
  if (top.length === 0) top = ['chat'];

  return { ...layout, top, bottom };
}

/** Manual-drag reposition. Chat may be reordered within the top row but never sent to the strip. */
export function repositionInLayout(layout: WorkspaceLayout, s: SurfaceId, target: RepositionTarget): WorkspaceLayout {
  let top = layout.top.filter((x) => x !== s);
  let bottom = layout.bottom === s ? null : layout.bottom;

  if (target === 'bottom') {
    if (s === 'chat') return layout; // chat never goes to the strip
    if (bottom) top = insertTop(top, bottom);
    bottom = s;
  } else if (target === 'top-left') {
    top = [s, ...top];
  } else {
    top = [...top, s];
  }

  if (top.length === 0) top = ['chat'];
  return { ...layout, top, bottom };
}

/** True when the workspace surface is not yet placed, so there is something to split to. */
export function layoutCanSplit(layout: WorkspaceLayout): boolean {
  return !layout.top.includes('workspace') && layout.bottom !== 'workspace';
}

/** Number of surfaces currently shown (top row + optional bottom strip). */
export function litSurfaceCount(layout: WorkspaceLayout): number {
  return layout.top.length + (layout.bottom ? 1 : 0);
}

/**
 * The dynamic floor: a lit surface that is the ONLY one shown is non-dismissable
 * (mirrors `04-engine.jsx` `isFloor = lit && litCount === 1`). Not a hardcoded
 * chat floor — whichever surface is last-lit becomes the floor.
 */
export function isSurfaceFloor(layout: WorkspaceLayout, id: SurfaceId): boolean {
  const lit = layout.top.includes(id) || layout.bottom === id;
  return lit && litSurfaceCount(layout) === 1;
}
