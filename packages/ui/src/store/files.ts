import { create } from 'zustand';

/**
 * Files surface store.
 *
 * Holds the pending reveal target — the path the tree should expand to, scroll
 * into view, and transiently highlight. The subscriber sets it; the FileTree
 * consumes it exactly once (same consume-once pattern as `consumeRevealTarget`
 * in editor.ts).
 *
 * Also owns `pickerOpen` — whether the file-open command-palette dialog is
 * visible. The intent subscriber sets this to true on `open-file-picker`;
 * the dialog component reads and clears it.
 */
interface FilesStore {
  /** Relative path to reveal in the file tree, or null when idle. */
  revealTarget: string | null;

  /** Whether the file-open picker dialog is currently open. */
  pickerOpen: boolean;

  /** Record the path to reveal. Called by intent-subscriber on reveal-file. */
  setRevealTarget: (path: string) => void;

  /** Read (do not clear) the reveal target. */
  getRevealTarget: () => string | null;

  /** Read and clear the reveal target atomically. Returns null when idle. */
  consumeRevealTarget: () => string | null;

  /** Open or close the file-open picker dialog. */
  setPickerOpen: (open: boolean) => void;
}

export const useFilesStore = create<FilesStore>()((set, get) => ({
  revealTarget: null,
  pickerOpen: false,

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

  setPickerOpen(open) {
    set({ pickerOpen: open });
  },
}));
