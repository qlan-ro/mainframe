import type { TriggerAdapter, TriggerCategory, TriggerItem } from './types';

export interface NavigationState {
  /** Categories to render — always empty in search mode. */
  categories: readonly TriggerCategory[];
  items: readonly TriggerItem[];
  isSearchMode: boolean;
  /** Flat list the keyboard walks: search results, category items, or categories. */
  navigableList: readonly (TriggerCategory | TriggerItem)[];
}

const EMPTY: NavigationState = { categories: [], items: [], isSearchMode: false, navigableList: [] };

const matchesQuery = (item: TriggerItem, lower: string): boolean =>
  item.id.toLowerCase().includes(lower) ||
  item.label.toLowerCase().includes(lower) ||
  (item.description?.toLowerCase().includes(lower) ?? false);

/** Adapters without `search()` get a scan over every category's items. */
function fallbackSearch(adapter: TriggerAdapter, categories: readonly TriggerCategory[], lower: string) {
  return categories.flatMap((cat) => adapter.categoryItems(cat.id).filter((item) => matchesQuery(item, lower)));
}

function searchFor(
  adapter: TriggerAdapter,
  categories: readonly TriggerCategory[],
  query: string,
  activeCategoryId: string | null,
): readonly TriggerItem[] | null {
  // Drilled into a category, or showing the category list for a bare trigger.
  if (activeCategoryId || (!query && categories.length > 0)) return null;
  return adapter.search?.(query) ?? fallbackSearch(adapter, categories, query.toLowerCase());
}

/**
 * Derives the visible list from the adapter, the query, and the drill-in state.
 * Pure — the caller owns `activeCategoryId` and when to call this at all.
 */
export function computeNavigation(
  adapter: TriggerAdapter | undefined,
  query: string,
  activeCategoryId: string | null,
): NavigationState {
  if (!adapter) return EMPTY;

  const categories = adapter.categories();
  const searchResults = searchFor(adapter, categories, query, activeCategoryId);
  if (searchResults !== null) {
    return { categories: [], items: searchResults, isSearchMode: true, navigableList: searchResults };
  }

  const lower = query.toLowerCase();
  const visibleCategories = query ? categories.filter((c) => c.label.toLowerCase().includes(lower)) : categories;
  const allItems = activeCategoryId ? adapter.categoryItems(activeCategoryId) : [];
  const items = query ? allItems.filter((item) => matchesQuery(item, lower)) : allItems;

  return {
    categories: visibleCategories,
    items,
    isSearchMode: false,
    navigableList: activeCategoryId ? items : visibleCategories,
  };
}
