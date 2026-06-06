/**
 * Async-over-sync file search: a debounce-friendly cache that fires fetches
 * once per distinct query and notifies subscribers when results land, plus a
 * synchronous trigger adapter that reads from the cache.
 */
import type { Unstable_TriggerItem } from '@assistant-ui/react';
import type { FileResult } from '@/lib/api/files';
import type { TriggerAdapter } from './skills-trigger-adapter';

const toItem = (f: FileResult): Unstable_TriggerItem => ({
  id: f.path,
  type: 'file',
  label: f.name,
  description: f.path,
});

export interface FileSearchCache {
  getItems(q: string): Unstable_TriggerItem[];
  request(q: string): void;
  subscribe(listener: () => void): () => void;
}

export function createFileSearchCache(fetcher: (q: string) => Promise<FileResult[]>): FileSearchCache {
  const cache = new Map<string, Unstable_TriggerItem[]>();
  const inflight = new Set<string>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  return {
    getItems: (q) => cache.get(q) ?? [],
    request: (q) => {
      // Authoritative empty-query guard (the chokepoint for BOTH the adapter
      // and FileSearchDriver paths): never fetch on a bare `@` — desktop
      // required ≥1 char and an empty file search is meaningless.
      if (q === '') return;
      if (cache.has(q) || inflight.has(q)) return;
      inflight.add(q);
      fetcher(q).then(
        (results) => {
          cache.set(q, results.map(toItem));
          inflight.delete(q);
          emit();
        },
        (err: unknown) => {
          console.warn('[files] search failed', err);
          inflight.delete(q);
        },
      );
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export function buildFileTriggerAdapter(cache: FileSearchCache): TriggerAdapter {
  const items = (q: string) => {
    // No fetch on a bare `@` (empty query) — desktop required ≥1 char; an empty
    // file search is meaningless and would spam the daemon. Results appear once
    // the user types.
    if (q === '') return [];
    cache.request(q);
    return cache.getItems(q);
  };
  return {
    // Search-first (no categories) so the native resource renders items for the
    // current query directly (mirrors skills-trigger-adapter; see its header).
    categories: () => [],
    categoryItems: () => items(''),
    search: (q) => items(q),
  };
}
