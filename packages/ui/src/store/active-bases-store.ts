/**
 * store/active-bases-store.ts
 *
 * Thin bridge store that carries the active workspace bases (worktreePath +
 * projectPath) from React-land into the intent subscriber (which runs outside
 * React). React components call `setActiveBases` on every active-session
 * change; the subscriber reads `getState()` at intent time.
 *
 * Only one set of bases is live at a time — the currently active thread.
 * An empty `{}` means "no active session" (new/draft thread).
 */
import { create } from 'zustand';
import type { FileBases } from '@/lib/files/file-ref';

interface ActiveBasesStore {
  bases: FileBases;
  setActiveBases: (bases: FileBases) => void;
}

export const useActiveBasesStore = create<ActiveBasesStore>()((set) => ({
  bases: {},
  setActiveBases(bases) {
    set({ bases });
  },
}));
