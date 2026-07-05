/**
 * Fetches and manages the tag registry for a given daemon port.
 *
 * Backed by a shared, module-level zustand store keyed by port — every
 * consumer calling `useTagRegistry(port)` for the same port reads and writes
 * the SAME cache. This matters because SessionSidebar (row tag dots) and
 * TagPopoverHost (the recolor panel) each mount their own instance of this
 * hook; before this store existed, they held independent `useState` caches
 * with no cross-invalidation, so recoloring a tag via the popover never
 * repainted the row dot (bug: tag recolor doesn't repaint row dots live).
 *
 * create/update/remove each refresh the registry afterwards. `colorOf`
 * returns a best-effort color for a tag name with a safe 'blue' default so
 * callers never need to guard for undefined. Backed by the Phase 1 tags API
 * client — never re-create that client here.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { create } from 'zustand';
import type { Tag, TagColor } from '@qlan-ro/mainframe-types';
import { listTags, createTag, updateTag, deleteTag } from '../../../lib/api/tags';

export interface TagRegistry {
  tags: Tag[];
  loading: boolean;
  refresh: () => Promise<void>;
  create: (name: string, color?: TagColor) => Promise<void>;
  update: (name: string, patch: { rename?: string; color?: TagColor }) => Promise<void>;
  remove: (name: string) => Promise<void>;
  colorOf: (name: string) => TagColor;
}

const DEFAULT_COLOR: TagColor = 'blue';

// Stable identity for "no tags fetched yet for this port" — a fresh `[]`
// literal in the selector below would change reference on every call and
// loop useSyncExternalStore (zustand) forever re-rendering.
const EMPTY_TAGS: Tag[] = [];

interface TagRegistryStoreState {
  tagsByPort: Record<number, Tag[]>;
  loadingByPort: Record<number, boolean>;
  refresh: (port: number) => Promise<void>;
}

/** Shared cache — see the module doc comment above for why this must NOT be
 *  per-component local state. Exported so tests can reset it between cases. */
export const useTagRegistryStore = create<TagRegistryStoreState>((set) => ({
  tagsByPort: {},
  loadingByPort: {},
  refresh: async (port: number): Promise<void> => {
    set((s) => ({ loadingByPort: { ...s.loadingByPort, [port]: true } }));
    try {
      const result = await listTags(port);
      set((s) => ({ tagsByPort: { ...s.tagsByPort, [port]: result } }));
    } catch (err) {
      console.warn('[tag-registry] refresh failed', err);
    } finally {
      set((s) => ({ loadingByPort: { ...s.loadingByPort, [port]: false } }));
    }
  },
}));

export function useTagRegistry(port: number): TagRegistry {
  const tags = useTagRegistryStore((s) => s.tagsByPort[port] ?? EMPTY_TAGS);
  const loading = useTagRegistryStore((s) => s.loadingByPort[port] ?? true);
  const storeRefresh = useTagRegistryStore((s) => s.refresh);

  const refresh = useCallback((): Promise<void> => storeRefresh(port), [storeRefresh, port]);

  // `refresh` is stable per port (useCallback over the stable store method + port),
  // so this re-fetches only when the port changes, not on every render.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (name: string, color?: TagColor): Promise<void> => {
      await createTag(port, name, color);
      await refresh();
    },
    [port, refresh],
  );

  const update = useCallback(
    async (name: string, patch: { rename?: string; color?: TagColor }): Promise<void> => {
      await updateTag(port, name, patch);
      await refresh();
    },
    [port, refresh],
  );

  const remove = useCallback(
    async (name: string): Promise<void> => {
      await deleteTag(port, name);
      await refresh();
    },
    [port, refresh],
  );

  const colorOf = useCallback(
    (name: string): TagColor => tags.find((t) => t.name === name)?.color ?? DEFAULT_COLOR,
    [tags],
  );

  return useMemo(
    () => ({ tags, loading, refresh, create, update, remove, colorOf }),
    [tags, loading, refresh, create, update, remove, colorOf],
  );
}
