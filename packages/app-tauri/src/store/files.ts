import { create } from 'zustand';

/**
 * Files surface store.
 *
 * Holds the pending reveal target — the path the tree should expand to, scroll
 * into view, and transiently highlight. The subscriber sets it; the FileTree
 * consumes it exactly once (same consume-once pattern as `consumeRevealTarget`
 * in editor.ts).
 */
interface FilesStore {
  /** Relative path to reveal in the file tree, or null when idle. */
  revealTarget: string | null;

  /** Record the path to reveal. Called by intent-subscriber on reveal-file. */
  setRevealTarget: (path: string) => void;

  /** Read (do not clear) the reveal target. */
  getRevealTarget: () => string | null;

  /** Read and clear the reveal target atomically. Returns null when idle. */
  consumeRevealTarget: () => string | null;
}

export const useFilesStore = create<FilesStore>()((set, get) => ({
  revealTarget: null,

  setRevealTarget(path) {
    set({ revealTarget: path });
  },

  getRevealTarget() {
    return get().revealTarget;
  },

  consumeRevealTarget() {
    const target = get().revealTarget;
    if (target === null) return null;
    set({ revealTarget: null });
    return target;
  },
}));
