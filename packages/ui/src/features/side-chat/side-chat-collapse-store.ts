/**
 * side-chat-collapse-store — per-parent collapsed/expanded state for the side
 * chat panel (todo #344, UI rule 3).
 *
 * Persisted under `mf:side-chat-collapsed:<parentChatId>` — ONE localStorage
 * key per parent, not a single JSON blob, so a store reset or a schema change
 * for one parent never touches another's. Expanded by default (an absent key
 * reads as not collapsed), matching #346's dismissal-store idiom
 * (`context-notice-dismissals.ts`) for the read/write shape while adding
 * zustand for reactivity — the panel (group `ui-side-chat-panel`) re-renders
 * on toggle without a manual re-render tick.
 */
import { create } from 'zustand';

function storageKey(parentChatId: string): string {
  return `mf:side-chat-collapsed:${parentChatId}`;
}

function readPersistedCollapsed(parentChatId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(parentChatId)) === 'true';
  } catch {
    // expected: localStorage can be unavailable (private mode) — default expanded.
    return false;
  }
}

function writePersistedCollapsed(parentChatId: string, collapsed: boolean): void {
  try {
    window.localStorage.setItem(storageKey(parentChatId), String(collapsed));
  } catch {
    // expected: a failed write just means the choice doesn't survive reload.
  }
}

interface SideChatCollapseState {
  /** In-memory cache, lazily seeded from localStorage per parent id on first read. */
  collapsedByParent: Record<string, boolean>;
  isCollapsed: (parentChatId: string) => boolean;
  setCollapsed: (parentChatId: string, collapsed: boolean) => void;
  /** A gate raised while the parent is on screen auto-expands the panel (AC 20). */
  expand: (parentChatId: string) => void;
  toggle: (parentChatId: string) => void;
}

export const useSideChatCollapseStore = create<SideChatCollapseState>((set, get) => ({
  collapsedByParent: {},
  isCollapsed: (parentChatId) => {
    const cached = get().collapsedByParent[parentChatId];
    return cached ?? readPersistedCollapsed(parentChatId);
  },
  setCollapsed: (parentChatId, collapsed) => {
    writePersistedCollapsed(parentChatId, collapsed);
    set((s) => ({ collapsedByParent: { ...s.collapsedByParent, [parentChatId]: collapsed } }));
  },
  expand: (parentChatId) => get().setCollapsed(parentChatId, false),
  toggle: (parentChatId) => get().setCollapsed(parentChatId, !get().isCollapsed(parentChatId)),
}));
