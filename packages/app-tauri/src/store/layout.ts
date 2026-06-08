import { create } from 'zustand';

export type SurfaceId = 'chat' | 'files' | 'run';

interface LayoutStore {
  surfaces: { chat: boolean; files: boolean; run: boolean };
  toggleSurface: (surface: SurfaceId) => void;
}

export const useLayoutStore = create<LayoutStore>((set, get) => ({
  surfaces: { chat: true, files: false, run: false },

  toggleSurface(surface) {
    const current = get().surfaces;
    const activeCount = Object.values(current).filter(Boolean).length;
    // Floor invariant: last active surface cannot be toggled off.
    if (current[surface] && activeCount === 1) return;
    set({ surfaces: { ...current, [surface]: !current[surface] } });
  },
}));
