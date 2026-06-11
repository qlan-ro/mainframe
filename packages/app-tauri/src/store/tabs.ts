/**
 * store/tabs.ts — Files surface tab model (Phase 7).
 *
 * Implements the preview-vs-permanent semantics from prototype/04-engine.jsx
 * `openTargetWS`:
 *  - opening a file in 'preview' mode replaces the existing preview tab (there
 *    is at most one preview tab at any time)
 *  - opening a file that is already open just focuses it (promotes if permanent)
 *  - 'permanent' tabs accumulate normally; they are never replaced by a preview
 *  - double-clicking a file or editing promotes preview → permanent
 *
 * This store is PURE — it owns no side-effects. The intent subscriber
 * (`store/intent-subscriber.ts`) is what activates the Files layout surface.
 */
import { create } from 'zustand';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TabKind = 'code' | 'diff' | 'viewer';
export type TabMode = 'preview' | 'permanent';

/** Disc fields shared by all kinds. */
interface TabBase {
  id: string;
  kind: TabKind;
  path: string;
  title: string;
  mode: TabMode;
}

/** Extra fields for a diff tab. */
export interface DiffTabModel extends TabBase {
  kind: 'diff';
  original?: string;
  modified?: string;
}

export type EditorTabModel = TabBase | DiffTabModel;

// ── Open-target descriptor (what the caller provides) ─────────────────────────

export interface OpenCodeTarget {
  kind: 'code' | 'viewer';
  path: string;
  title: string;
}

export interface OpenDiffTarget {
  kind: 'diff';
  path: string;
  title: string;
  original?: string;
  modified?: string;
}

export type OpenTabTarget = OpenCodeTarget | OpenDiffTarget;

export interface OpenTabOptions {
  mode: TabMode;
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface TabsStore {
  tabs: EditorTabModel[];
  activeTabId: string | null;

  /**
   * Open or focus a tab.
   *  - If the path is already open: activate it (promote if mode=permanent).
   *  - If mode='preview': replace the existing preview slot, or append.
   *  - If mode='permanent': append a new tab.
   */
  openTab: (target: OpenTabTarget, opts: OpenTabOptions) => void;

  /** Promote a preview tab to permanent (double-click / first edit). */
  promoteTab: (id: string) => void;

  /** Close a tab; activates the nearest sibling if the closed tab was active. */
  closeTab: (id: string) => void;

  /** Activate a tab by id. */
  activateTab: (id: string) => void;
}

// ── ID generator ─────────────────────────────────────────────────────────────

let _seq = 0;
function genTabId(kind: TabKind): string {
  _seq += 1;
  return `tab-${kind}-${_seq}`;
}

// ── Pure reducer helpers ──────────────────────────────────────────────────────

/** Build an EditorTabModel from an open-target descriptor. */
function buildTab(target: OpenTabTarget, mode: TabMode): EditorTabModel {
  const base: TabBase = {
    id: genTabId(target.kind),
    kind: target.kind,
    path: target.path,
    title: target.title,
    mode,
  };
  if (target.kind === 'diff') {
    return { ...base, kind: 'diff', original: target.original, modified: target.modified } as DiffTabModel;
  }
  return base;
}

/**
 * Pure open-tab reducer — mirrors openTargetWS from 04-engine.jsx.
 * Returns [newTabs, newActiveId].
 */
function reduceOpenTab(
  tabs: EditorTabModel[],
  target: OpenTabTarget,
  opts: OpenTabOptions,
): [EditorTabModel[], string] {
  // (1) Already open — focus it (and promote if mode=permanent).
  const existing = tabs.find((t) => t.path === target.path && t.kind === target.kind);
  if (existing) {
    const promoted = opts.mode === 'permanent' && existing.mode === 'preview';
    if (promoted) {
      return [tabs.map((t) => (t.id === existing.id ? { ...t, mode: 'permanent' } : t)), existing.id];
    }
    return [tabs, existing.id];
  }

  // (2) Preview mode: replace the existing preview slot if one exists.
  if (opts.mode === 'preview') {
    const previewIdx = tabs.findIndex((t) => t.mode === 'preview');
    const tab = buildTab(target, 'preview');
    if (previewIdx >= 0) {
      const next = [...tabs];
      next[previewIdx] = tab;
      return [next, tab.id];
    }
    return [[...tabs, tab], tab.id];
  }

  // (3) Permanent mode: always append.
  const tab = buildTab(target, 'permanent');
  return [[...tabs, tab], tab.id];
}

/** Pure close-tab reducer. Returns [newTabs, newActiveId]. */
function reduceCloseTab(
  tabs: EditorTabModel[],
  activeTabId: string | null,
  id: string,
): [EditorTabModel[], string | null] {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx < 0) return [tabs, activeTabId];

  const next = tabs.filter((t) => t.id !== id);
  if (next.length === 0) return [next, null];

  // If the closed tab was active, move to the tab before it (or 0).
  let nextActive = activeTabId;
  if (activeTabId === id) {
    const fallbackIdx = Math.max(0, idx - 1);
    nextActive = next[fallbackIdx]?.id ?? null;
  }
  return [next, nextActive];
}

// ── Store instance ────────────────────────────────────────────────────────────

export const useTabsStore = create<TabsStore>()((set, get) => ({
  tabs: [],
  activeTabId: null,

  openTab(target, opts) {
    const { tabs, activeTabId: _unused } = get();
    const [nextTabs, nextActiveId] = reduceOpenTab(tabs, target, opts);
    set({ tabs: nextTabs, activeTabId: nextActiveId });
  },

  promoteTab(id) {
    set((prev) => ({
      tabs: prev.tabs.map((t) => (t.id === id && t.mode === 'preview' ? { ...t, mode: 'permanent' } : t)),
    }));
  },

  closeTab(id) {
    const { tabs, activeTabId } = get();
    const [nextTabs, nextActiveId] = reduceCloseTab(tabs, activeTabId, id);
    set({ tabs: nextTabs, activeTabId: nextActiveId });
  },

  activateTab(id) {
    set({ activeTabId: id });
  },
}));
