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

/**
 * Target position to reveal when an editor for a given path first mounts (or
 * when the reveal target changes). Stashed by intent-subscriber when an
 * `open-file` intent includes a `line`/`character` position. Consumed
 * (and cleared) by CmEditor on mount to scroll to the target line.
 */
export interface RevealTarget {
  /** 0-based line number. */
  line: number;
  /** 0-based character offset within the line. */
  character: number;
}

/** Maximum number of entries kept in the buffers and viewStates caches. */
const CACHE_CAP = 50;

/**
 * Evict the oldest (first-inserted) entry from a Map when its size exceeds
 * CACHE_CAP. Uses insertion-order iteration — Map guarantees this.
 */
function evictOldest<K, V>(map: Map<K, V>): Map<K, V> {
  if (map.size <= CACHE_CAP) return map;
  const firstKey = map.keys().next().value as K;
  const next = new Map(map);
  next.delete(firstKey);
  return next;
}

interface EditorStore {
  /** view-state (selection + scroll) per absolute path */
  viewStates: Map<string, EditorViewState>;
  /** in-memory value cache per absolute path */
  buffers: Map<string, EditorBufferState>;
  /**
   * Pending reveal targets keyed by absolute path. Set by intent-subscriber
   * when an `open-file` intent carries a position. Consumed and cleared by
   * CmEditor on mount so the scroll fires exactly once.
   */
  revealTargets: Map<string, RevealTarget>;

  saveViewState: (path: string, state: EditorViewState) => void;
  getViewState: (path: string) => EditorViewState | undefined;

  setBuffer: (path: string, value: string, dirty?: boolean) => void;
  getBuffer: (path: string) => EditorBufferState | undefined;
  clearBuffer: (path: string) => void;

  /** Stash a reveal target for the given path (called by intent-subscriber). */
  setRevealTarget: (path: string, target: RevealTarget) => void;
  /** Read (but do not clear) the reveal target for a path. */
  getRevealTarget: (path: string) => RevealTarget | undefined;
  /** Consume (read + clear) the reveal target for a path. */
  consumeRevealTarget: (path: string) => RevealTarget | undefined;
}

export const useEditorStore = create<EditorStore>()((set, get) => ({
  viewStates: new Map(),
  buffers: new Map(),
  revealTargets: new Map(),

  saveViewState(path, state) {
    set((prev) => {
      const draft = new Map(prev.viewStates);
      draft.set(path, state);
      return { viewStates: evictOldest(draft) };
    });
  },

  getViewState(path) {
    return get().viewStates.get(path);
  },

  setBuffer(path, value, dirty = false) {
    set((prev) => {
      const draft = new Map(prev.buffers);
      draft.set(path, { value, dirty });
      return { buffers: evictOldest(draft) };
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

  setRevealTarget(path, target) {
    set((prev) => {
      const next = new Map(prev.revealTargets);
      next.set(path, target);
      return { revealTargets: next };
    });
  },

  getRevealTarget(path) {
    return get().revealTargets.get(path);
  },

  consumeRevealTarget(path) {
    const target = get().revealTargets.get(path);
    if (target === undefined) return undefined;
    set((prev) => {
      const next = new Map(prev.revealTargets);
      next.delete(path);
      return { revealTargets: next };
    });
    return target;
  },
}));
