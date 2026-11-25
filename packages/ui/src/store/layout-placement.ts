/**
 * store/layout-placement.ts — pure workspace-layout types and placement
 * helpers. Split out of `layout.ts` (#281 Task 32): these touch no store state,
 * unlike the tab mutators, which close over `get()`/`writeWorkspace`.
 *
 * Two surfaces side by side, chat left of the workspace (W4). Either can be
 * hidden, never both.
 */

export type SurfaceId = 'chat' | 'workspace';

export interface WorkspaceLayout {
  /** The lit surfaces, left to right. */
  top: SurfaceId[];
  /** Flex weights of the lit surfaces (set by drag; an even split without). */
  topFlex: Partial<Record<SurfaceId, number>>;
}

const ORDER: readonly SurfaceId[] = ['chat', 'workspace'];

/** Lights a surface; chat always takes the left. */
export function placeInLayout(layout: WorkspaceLayout, s: SurfaceId): WorkspaceLayout {
  if (layout.top.includes(s)) return layout;
  return { ...layout, top: ORDER.filter((id) => id === s || layout.top.includes(id)) };
}

/** Hides a surface. Never zero surfaces: hiding the last one brings chat back. */
export function removeSurface(layout: WorkspaceLayout, s: SurfaceId): WorkspaceLayout {
  const top = layout.top.filter((x) => x !== s);
  return { ...layout, top: top.length === 0 ? ['chat'] : top };
}

/** True while the surface is on screen. */
export function isSurfaceLit(layout: WorkspaceLayout, id: SurfaceId): boolean {
  return layout.top.includes(id);
}

/**
 * The dynamic floor: a lit surface that is the ONLY one shown is non-dismissable.
 * Not a hardcoded chat floor — whichever surface is last-lit becomes the floor.
 */
export function isSurfaceFloor(layout: WorkspaceLayout, id: SurfaceId): boolean {
  return isSurfaceLit(layout, id) && layout.top.length === 1;
}
