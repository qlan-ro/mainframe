/**
 * Client-side session filter state.
 *
 * filterProjectId is persisted to localStorage ('mf:filterProjectId') so the
 * active project filter survives navigation. It must be cleared when the user
 * activates a chat in a different project (clear-on-cross-project-activate —
 * see §5.4 of the design spec). That reconciliation lives in the
 * session-list-router or the thread-activate handler, which calls
 * setFilterProjectId(null) when the activated chat's projectId !== current
 * filterProjectId.
 */
import { create } from 'zustand';
import type { SyntheticTag } from '@qlan-ro/mainframe-types';
import type { SortMode } from '@/features/sessions/view-model/group-sessions';

const STORAGE_KEY = 'mf:filterProjectId';

interface SessionFiltersState {
  filterProjectId: string | null;
  selectedTags: Set<string>;
  selectedSynthetic: Set<SyntheticTag>;
  /** Active sessions-list sort: drives arrangeSessions grouping/ordering. */
  sortMode: SortMode;
  setFilterProjectId: (id: string | null) => void;
  toggleTag: (t: string) => void;
  toggleSynthetic: (s: SyntheticTag) => void;
  setSortMode: (mode: SortMode) => void;
  clearFilters: () => void;
}

function persistProjectId(id: string | null): void {
  if (id !== null) {
    localStorage.setItem(STORAGE_KEY, id);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export const useSessionFilters = create<SessionFiltersState>((set) => ({
  filterProjectId: localStorage.getItem(STORAGE_KEY),
  selectedTags: new Set<string>(),
  selectedSynthetic: new Set<SyntheticTag>(),
  sortMode: 'recent',

  setFilterProjectId: (id) => {
    persistProjectId(id);
    set({ filterProjectId: id });
  },

  setSortMode: (mode) => set({ sortMode: mode }),

  toggleTag: (t) =>
    set((state) => {
      const next = new Set(state.selectedTags);
      if (next.has(t)) {
        next.delete(t);
      } else {
        next.add(t);
      }
      return { selectedTags: next };
    }),

  toggleSynthetic: (s) =>
    set((state) => {
      const next = new Set(state.selectedSynthetic);
      if (next.has(s)) {
        next.delete(s);
      } else {
        next.add(s);
      }
      return { selectedSynthetic: next };
    }),

  clearFilters: () => {
    persistProjectId(null);
    set({
      filterProjectId: null,
      selectedTags: new Set<string>(),
      selectedSynthetic: new Set<SyntheticTag>(),
    });
  },
}));
