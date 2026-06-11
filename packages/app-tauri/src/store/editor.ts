import { create } from 'zustand';

/**
 * Per-file view-state snapshot: selection anchor/head + scroll offset.
 * Replaces Monaco's free `editor.saveViewState()` / `editor.restoreViewState()`.
 *
 * Keyed by the absolute file path so switching tabs and back restores exactly
 * where the user was. The tab model (Phase 7) will extend this store with
 * open-tabs; here we only keep the minimal view-state cache needed by CmEditor.
 */
export interface EditorViewState {
  selectionAnchor: number;
  selectionHead: number;
  scrollTop: number;
}

/**
 * Per-file value cache. Populated when the editor first loads a file and kept
 * in sync with onChange. Phase 7 reads this to seed EditorTab without an
 * extra API call when the tab is already open in a background pane.
 */
export interface EditorBufferState {
  value: string;
  dirty: boolean;
}

interface EditorStore {
  /** view-state (selection + scroll) per absolute path */
  viewStates: Map<string, EditorViewState>;
  /** in-memory value cache per absolute path */
  buffers: Map<string, EditorBufferState>;

  saveViewState: (path: string, state: EditorViewState) => void;
  getViewState: (path: string) => EditorViewState | undefined;

  setBuffer: (path: string, value: string, dirty?: boolean) => void;
  getBuffer: (path: string) => EditorBufferState | undefined;
  clearBuffer: (path: string) => void;
}

export const useEditorStore = create<EditorStore>()((set, get) => ({
  viewStates: new Map(),
  buffers: new Map(),

  saveViewState(path, state) {
    set((prev) => {
      const next = new Map(prev.viewStates);
      next.set(path, state);
      return { viewStates: next };
    });
  },

  getViewState(path) {
    return get().viewStates.get(path);
  },

  setBuffer(path, value, dirty = false) {
    set((prev) => {
      const next = new Map(prev.buffers);
      next.set(path, { value, dirty });
      return { buffers: next };
    });
  },

  getBuffer(path) {
    return get().buffers.get(path);
  },

  clearBuffer(path) {
    set((prev) => {
      const next = new Map(prev.buffers);
      next.delete(path);
      return { buffers: next };
    });
  },
}));
