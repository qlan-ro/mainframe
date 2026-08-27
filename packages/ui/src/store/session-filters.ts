/**
 * Client-side session filter state.
 *
 * filterProjectIds is the project SCOPE: the sessions list shows only sessions
 * whose project is in the set, and an empty set means "all projects". It is
 * persisted to localStorage ('mf:filterProjectIds') so the scope survives
 * navigation. It must be cleared when the user activates a chat in a project
 * outside the scope (clear-on-cross-project-activate — see §5.4 of the design
 * spec). That reconciliation lives in the session-list-router or the
 * thread-activate handler, which calls clearProjectFilter() when the activated
 * chat's projectId is not in the scope.
 */
import { create } from 'zustand';
import type { SyntheticTag } from '@qlan-ro/mainframe-types';
import type { SortMode } from '@/features/sessions/view-model/group-sessions';
import { daemonScopedKey } from '@/lib/daemon/daemon-scoped-storage';

const BASE_KEY = 'mf:filterProjectIds';
/** Pre-multi-select key (single id, plain string) — migrated on init. */
const LEGACY_BASE_KEY = 'mf:filterProjectId';

/** The scoped project when exactly one is selected, else null. Consumers with
 *  single-project semantics (new-session target, draft seeding, modal scope)
 *  share this one definition so they can never disagree about "the" project. */
export function soleProjectId(ids: ReadonlySet<string>): string | null {
  if (ids.size !== 1) return null;
  const [only] = ids;
  return only ?? null;
}

interface SessionFiltersState {
  filterProjectIds: ReadonlySet<string>;
  selectedTags: Set<string>;
  selectedSynthetic: Set<SyntheticTag>;
  /** Active sessions-list sort: drives arrangeSessions grouping/ordering. */
  sortMode: SortMode;
  toggleFilterProject: (id: string) => void;
  clearProjectFilter: () => void;
  /** Drop a deleted project from the scope; the rest of the scope survives. */
  removeFilterProject: (id: string) => void;
  toggleTag: (t: string) => void;
  toggleSynthetic: (s: SyntheticTag) => void;
  setSortMode: (mode: SortMode) => void;
  clearFilters: () => void;
}

function persistProjectIds(ids: ReadonlySet<string>): void {
  if (ids.size > 0) {
    localStorage.setItem(daemonScopedKey(BASE_KEY), JSON.stringify(Array.from(ids)));
  } else {
    localStorage.removeItem(daemonScopedKey(BASE_KEY));
  }
}

function loadPersistedProjectIds(): ReadonlySet<string> {
  const raw = localStorage.getItem(daemonScopedKey(BASE_KEY));
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === 'string'));
    } catch {
      /* expected: a corrupt entry reads as no scope */
    }
    return new Set();
  }
  const legacy = localStorage.getItem(daemonScopedKey(LEGACY_BASE_KEY));
  if (legacy === null) return new Set();
  const migrated = new Set([legacy]);
  persistProjectIds(migrated);
  localStorage.removeItem(daemonScopedKey(LEGACY_BASE_KEY));
  return migrated;
}

export const useSessionFilters = create<SessionFiltersState>((set) => ({
  filterProjectIds: loadPersistedProjectIds(),
  selectedTags: new Set<string>(),
  selectedSynthetic: new Set<SyntheticTag>(),
  sortMode: 'recent',

  toggleFilterProject: (id) =>
    set((state) => {
      const next = new Set(state.filterProjectIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      persistProjectIds(next);
      return { filterProjectIds: next };
    }),

  clearProjectFilter: () => {
    persistProjectIds(new Set());
    set({ filterProjectIds: new Set<string>() });
  },

  removeFilterProject: (id) =>
    set((state) => {
      if (!state.filterProjectIds.has(id)) return state;
      const next = new Set(state.filterProjectIds);
      next.delete(id);
      persistProjectIds(next);
      return { filterProjectIds: next };
    }),

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
    persistProjectIds(new Set());
    set({
      filterProjectIds: new Set<string>(),
      selectedTags: new Set<string>(),
      selectedSynthetic: new Set<SyntheticTag>(),
    });
  },
}));
