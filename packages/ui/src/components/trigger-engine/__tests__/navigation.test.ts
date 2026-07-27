/**
 * Compatibility contract for `computeNavigation`.
 *
 * Pinned to assistant-ui 0.14.27's `triggerNavigationResource` derivation:
 * search mode wins whenever there is no active category and either a non-empty
 * query or no categories at all; otherwise the list is categories (top level)
 * or that category's items (drilled in), each filtered by the query.
 */
import { describe, it, expect } from 'vitest';
import { computeNavigation } from '../navigation';
import type { TriggerAdapter, TriggerItem } from '../types';

const item = (id: string, label = id, description?: string): TriggerItem => ({
  id,
  type: 'skill',
  label,
  description,
});

/** Mirrors our real adapters: no categories, search-first. */
const searchFirst: TriggerAdapter = {
  categories: () => [],
  categoryItems: () => [item('alpha'), item('beta')],
  search: (q) => [item('alpha'), item('beta')].filter((i) => i.id.includes(q)),
};

/** Mirrors the library's category path: categories, no `search`. */
const categorized: TriggerAdapter = {
  categories: () => [
    { id: 'cat-a', label: 'Alpha things' },
    { id: 'cat-b', label: 'Beta things' },
  ],
  categoryItems: (id) =>
    id === 'cat-a' ? [item('a-one', 'One'), item('a-two', 'Two', 'about queues')] : [item('b-one', 'One')],
};

describe('computeNavigation — search-first adapter (no categories)', () => {
  it('runs search for an empty query when the adapter has no categories', () => {
    const nav = computeNavigation(searchFirst, '', null);
    expect(nav.isSearchMode).toBe(true);
    expect(nav.items.map((i) => i.id)).toEqual(['alpha', 'beta']);
    expect(nav.navigableList.map((e) => e.id)).toEqual(['alpha', 'beta']);
  });

  it('filters through the adapter search for a non-empty query', () => {
    const nav = computeNavigation(searchFirst, 'al', null);
    expect(nav.items.map((i) => i.id)).toEqual(['alpha']);
  });

  it('reports no categories in search mode', () => {
    expect(computeNavigation(searchFirst, 'al', null).categories).toEqual([]);
  });

  it('yields an empty navigable list when nothing matches', () => {
    const nav = computeNavigation(searchFirst, 'zzz', null);
    expect(nav.isSearchMode).toBe(true);
    expect(nav.navigableList).toEqual([]);
  });
});

describe('computeNavigation — categorized adapter', () => {
  it('lists categories (not search) for an empty query at the top level', () => {
    const nav = computeNavigation(categorized, '', null);
    expect(nav.isSearchMode).toBe(false);
    expect(nav.navigableList.map((e) => e.id)).toEqual(['cat-a', 'cat-b']);
  });

  it('enters search mode for a non-empty query at the top level', () => {
    const nav = computeNavigation(categorized, 'one', null);
    expect(nav.isSearchMode).toBe(true);
    expect(nav.navigableList.map((e) => e.id)).toEqual(['a-one', 'b-one']);
  });

  it('falls back to matching id, label, and description when the adapter has no search()', () => {
    const nav = computeNavigation(categorized, 'queues', null);
    expect(nav.items.map((i) => i.id)).toEqual(['a-two']);
  });

  it('matches case-insensitively', () => {
    expect(computeNavigation(categorized, 'QUEUES', null).items.map((i) => i.id)).toEqual(['a-two']);
  });

  it('lists the active category items when drilled in, never search results', () => {
    const nav = computeNavigation(categorized, '', 'cat-a');
    expect(nav.isSearchMode).toBe(false);
    expect(nav.navigableList.map((e) => e.id)).toEqual(['a-one', 'a-two']);
  });

  it('filters the active category items by the query', () => {
    const nav = computeNavigation(categorized, 'two', 'cat-a');
    expect(nav.isSearchMode).toBe(false);
    expect(nav.navigableList.map((e) => e.id)).toEqual(['a-two']);
  });

  it('filters top-level categories by label when the adapter search returns nothing to prefer', () => {
    const withSearch: TriggerAdapter = { ...categorized, search: () => [] };
    const nav = computeNavigation(withSearch, '', null);
    expect(nav.categories.map((c) => c.id)).toEqual(['cat-a', 'cat-b']);
  });
});

describe('computeNavigation — no adapter', () => {
  it('returns an empty, non-search state', () => {
    const nav = computeNavigation(undefined, 'anything', null);
    expect(nav).toEqual({ categories: [], items: [], isSearchMode: false, navigableList: [] });
  });
});
