/**
 * Fetches and manages the tag registry for a given daemon port.
 *
 * create/update/remove each refresh the registry afterwards. `colorOf`
 * returns a best-effort color for a tag name with a safe 'blue' default so
 * callers never need to guard for undefined. Backed by the Phase 1 tags API
 * client — never re-create that client here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
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

export function useTagRegistry(port: number): TagRegistry {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const result = await listTags(port);
      setTags(result);
    } catch (err) {
      console.warn('[tag-registry] refresh failed', err);
    } finally {
      setLoading(false);
    }
  }, [port]);

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
