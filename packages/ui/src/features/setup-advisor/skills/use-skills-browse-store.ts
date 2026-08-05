/**
 * use-skills-browse-store — the registry side of the Skills section: the
 * skills.sh catalog and its search index.
 *
 * The two lists never merge. Below `MIN_QUERY` characters the panel shows the
 * catalog's top rows; at or above it shows search results, and only search
 * results — so what is on screen is always unambiguously one or the other. The
 * catalog is a snapshot of the registry's leaderboard and doesn't contain
 * everything, which is why searching goes to the API rather than filtering it.
 *
 * Installing is not here: it stays in `use-skills-cli-store`, which already
 * owns the one-operation-at-a-time state and re-reads the manifest afterwards.
 *
 * The debounce timer and the stale-completion counter are module-level, the
 * `use-skills-cli-store` idiom — outside React so they survive renders, outside
 * the store so a `set()` cannot reset them.
 */
import { create } from 'zustand';
import type { SkillsCatalogEntry, SkillsSearchResult } from '@qlan-ro/mainframe-types';
import { getSkillsCatalog, searchSkills } from '@/lib/api/skills-cli';

/** The daemon rejects anything shorter, so the store must not send it. */
export const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;
/**
 * The daemon returns the registry's whole leaderboard (~600 rows); the head is
 * what a browse is. The tail is dropped at load rather than at render so the
 * row selector can return a stable reference — a selector that slices on every
 * call re-renders forever under zustand's `useSyncExternalStore`.
 */
const CATALOG_ROWS = 50;

let _searchSeq = 0;
let _debounce: ReturnType<typeof setTimeout> | null = null;

export type CatalogStatus = 'idle' | 'loading' | 'available' | 'unavailable';
export type SearchStatus = 'idle' | 'searching' | 'done' | 'error';

/** The row shape both lists satisfy; search results carry no sparkline. */
export interface BrowseItem {
  source: string;
  skillId: string;
  name: string;
  installs: number;
  /** `null`/absent means unknown — the search API doesn't report it. */
  isOfficial?: boolean | null;
}

interface SkillsBrowseState {
  /** The head of the registry's leaderboard — at most `CATALOG_ROWS` rows. */
  catalog: SkillsCatalogEntry[];
  catalogStatus: CatalogStatus;
  query: string;
  results: SkillsSearchResult[];
  searchStatus: SearchStatus;
  searchError: string | null;
  loadCatalog: () => Promise<void>;
  setQuery: (query: string) => void;
  reset: () => void;
}

/** Identity of one browse row — a skill id is only unique within its source. */
export const browseKey = (item: BrowseItem): string => `${item.source}/${item.skillId}`;

export const useSkillsBrowseStore = create<SkillsBrowseState>((set, get) => ({
  catalog: [],
  catalogStatus: 'idle',
  query: '',
  results: [],
  searchStatus: 'idle',
  searchError: null,

  loadCatalog: async () => {
    // Loaded once per opening of the section, not once per mount of Browse:
    // switching to Installed and back unmounts this tab, and re-reading here
    // would flash skeletons over a list the user was already looking at. A
    // retry after `unavailable` is a matter of reopening the section, which
    // calls `reset` and puts the status back to idle.
    if (get().catalogStatus !== 'idle') return;
    set({ catalogStatus: 'loading' });
    try {
      const catalog = await getSkillsCatalog();
      if (catalog.status === 'unavailable') {
        set({ catalogStatus: 'unavailable', catalog: [] });
        return;
      }
      set({ catalogStatus: 'available', catalog: catalog.entries.slice(0, CATALOG_ROWS) });
    } catch {
      // The catalog is a convenience, not the feature: a failed load leaves
      // search as the way in, exactly like the daemon's `unavailable`.
      set({ catalogStatus: 'unavailable', catalog: [] });
    }
  },

  setQuery: (query) => {
    set({ query });
    if (_debounce) clearTimeout(_debounce);

    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY) {
      // Dropping back under the floor abandons the in-flight search too, or its
      // results would land on top of the catalog the user just went back to.
      _searchSeq++;
      set({ results: [], searchStatus: 'idle', searchError: null });
      return;
    }

    set({ searchStatus: 'searching', searchError: null });
    _debounce = setTimeout(() => {
      void runSearch(trimmed, set);
    }, DEBOUNCE_MS);
  },

  reset: () => {
    _searchSeq++;
    if (_debounce) clearTimeout(_debounce);
    _debounce = null;
    set({
      catalog: [],
      catalogStatus: 'idle',
      query: '',
      results: [],
      searchStatus: 'idle',
      searchError: null,
    });
  },
}));

type SetState = (partial: Partial<SkillsBrowseState>) => void;

async function runSearch(query: string, set: SetState): Promise<void> {
  const seq = ++_searchSeq;
  try {
    const results = await searchSkills(query);
    if (seq !== _searchSeq) return;
    set({ results, searchStatus: 'done' });
  } catch (err) {
    if (seq !== _searchSeq) return;
    set({
      results: [],
      searchStatus: 'error',
      searchError: err instanceof Error ? err.message : 'Could not search the skills registry',
    });
  }
}

/** Which list the panel is showing — derived from the query alone. */
export function selectBrowseMode(s: SkillsBrowseState): 'catalog' | 'search' {
  return s.query.trim().length < MIN_QUERY ? 'catalog' : 'search';
}

export function selectBrowseRows(s: SkillsBrowseState): BrowseItem[] {
  return selectBrowseMode(s) === 'search' ? s.results : s.catalog;
}
