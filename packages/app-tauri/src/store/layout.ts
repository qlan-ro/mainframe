import { create } from 'zustand';

export type SurfaceId = 'chat' | 'files' | 'run';

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

// ── placement helpers (mirror 04-engine.jsx placeInLayout / removeSurface) ──

function insertTop(top: SurfaceId[], s: SurfaceId): SurfaceId[] {
  if (s === 'chat') return ['chat', ...top.filter((x) => x !== 'chat')];
  // Non-chat: keep chat leftmost, append new surface after existing ones.
  return [...top, s];
}

function placeInLayout(layout: WorkspaceLayout, s: SurfaceId): WorkspaceLayout {
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

function removeSurface(layout: WorkspaceLayout, s: SurfaceId): WorkspaceLayout {
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

/** True when at least one of files/run is not yet in the layout. */
export function layoutCanSplit(layout: WorkspaceLayout): boolean {
  return (['files', 'run'] as SurfaceId[]).some((s) => !layout.top.includes(s) && layout.bottom !== s);
}

// ── store ─────────────────────────────────────────────────────────────────

const INITIAL_LAYOUT: WorkspaceLayout = {
  top: ['chat'],
  bottom: null,
  topFlex: {},
  vFlex: { top: 1, bottom: 0.4 },
};

interface LayoutStore {
  layout: WorkspaceLayout;
  sidebarVisible: boolean;
  toggleSurface: (surface: SurfaceId) => void;
  toggleSidebar: () => void;
  /** Called by the horizontal SurfDivider; frac = fraction of the top-row width. */
  setTopFrac: (frac: number) => void;
  /** Called by the vertical SurfDivider; frac = fraction of the total height. */
  setVFrac: (frac: number) => void;
  /** Add the next missing surface side-by-side ('v') or to the bottom strip ('h'). */
  splitSurface: (orientation: 'v' | 'h') => void;
}

export const useLayoutStore = create<LayoutStore>((set, get) => ({
  layout: INITIAL_LAYOUT,
  sidebarVisible: true,

  toggleSurface(surface) {
    // Chat is the permanent floor — always available, never removable.
    if (surface === 'chat') return;
    const { layout } = get();
    const isActive = layout.top.includes(surface) || layout.bottom === surface;
    if (isActive) {
      set({ layout: removeSurface(layout, surface) });
    } else {
      set({ layout: placeInLayout(layout, surface) });
    }
  },

  toggleSidebar() {
    set((s) => ({ sidebarVisible: !s.sidebarVisible }));
  },

  setTopFrac(frac) {
    const { layout } = get();
    if (layout.top.length < 2) return;
    const [a, b] = layout.top as [SurfaceId, SurfaceId];
    const c = Math.max(0.18, Math.min(0.82, frac));
    set({ layout: { ...layout, topFlex: { ...layout.topFlex, [a]: c, [b]: 1 - c } } });
  },

  setVFrac(frac) {
    const { layout } = get();
    const c = Math.max(0.18, Math.min(0.82, frac));
    set({ layout: { ...layout, vFlex: { top: c, bottom: 1 - c } } });
  },

  splitSurface(orientation) {
    const { layout } = get();
    const next = (['files', 'run'] as SurfaceId[]).find((s) => !layout.top.includes(s) && layout.bottom !== s);
    if (!next) return;
    if (orientation === 'v') {
      set({ layout: placeInLayout(layout, next) });
    } else {
      if (layout.bottom) return;
      set({ layout: { ...layout, bottom: next } });
    }
  },
}));
