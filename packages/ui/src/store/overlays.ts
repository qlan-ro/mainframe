/**
 * Open-state for the global overlay surfaces (search palette, find-in-path,
 * review modal). Mirrors store/files.ts: a flag per overlay, mutated by the
 * intent subscriber and the overlay's own close handler. The directory picker
 * is NOT here — it is a promise-bridge (features/files/use-directory-picker.ts).
 */
import { create } from 'zustand';

export interface FindInPathScope {
  scopePath: string;
  scopeType: 'file' | 'directory';
}

interface OverlaysStore {
  paletteOpen: boolean;
  findInPath: FindInPathScope | null;
  reviewOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  setFindInPath: (scope: FindInPathScope | null) => void;
  setReviewOpen: (open: boolean) => void;
}

export const useOverlaysStore = create<OverlaysStore>()((set) => ({
  paletteOpen: false,
  findInPath: null,
  reviewOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setFindInPath: (scope) => set({ findInPath: scope }),
  setReviewOpen: (open) => set({ reviewOpen: open }),
}));
