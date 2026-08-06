/**
 * Every write the tag popover can make, and the one error line it reports them
 * through.
 *
 * Rename and delete cascade: the daemon rewrites its own tables but broadcasts
 * nothing for the chats it touched, so the loaded threads are re-tagged from
 * here. Recolor never cascades — the color lives in the registry, not on the
 * chat.
 */
import { useCallback, useState } from 'react';
import type { TagColor } from '@qlan-ro/mainframe-types';
import { setChatTags } from '@/lib/api/tags';
import {
  buildTagCascade,
  type ThreadTagSnapshot,
  type TagCascadeUpdate,
} from '@/features/sessions/tags/build-tag-cascade';
import { validateTagName } from '@/features/sessions/tags/validate-tag-name';
import type { TagRegistry } from '@/features/sessions/tags/use-tag-registry';

interface TagMutationsArgs {
  port: number;
  chatId: string;
  currentTags: string[];
  registry: TagRegistry;
  threads: ThreadTagSnapshot[];
  onCascade: (updates: TagCascadeUpdate[]) => void;
  onReload?: () => void;
}

export interface TagMutations {
  error: string | null;
  clearError: () => void;
  toggle: (name: string) => Promise<void>;
  createAndApply: (name: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  recolor: (name: string, color: TagColor) => Promise<void>;
  remove: (name: string) => Promise<void>;
}

export function useTagMutations({
  port,
  chatId,
  currentTags,
  registry,
  threads,
  onCascade,
  onReload,
}: TagMutationsArgs): TagMutations {
  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(async (what: string, action: () => Promise<void>): Promise<void> => {
    setError(null);
    try {
      await action();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : `${what} failed`);
      console.warn(`[v2/useTagMutations] ${what} failed`, e);
    }
  }, []);

  const cascade = useCallback(
    (from: string, to: string | null) => {
      const updates = buildTagCascade(threads, from, to);
      if (updates.length > 0) onCascade(updates);
    },
    [threads, onCascade],
  );

  const toggle = useCallback(
    (name: string) =>
      run('Update tags', async () => {
        const next = new Set(currentTags);
        if (!next.delete(name)) next.add(name);
        await setChatTags(port, chatId, [...next]);
        onReload?.();
      }),
    [run, currentTags, port, chatId, onReload],
  );

  const createAndApply = useCallback(
    (name: string) =>
      run('Create', async () => {
        await registry.create(name, undefined);
        await setChatTags(port, chatId, [...currentTags, name]);
        onReload?.();
      }),
    [run, registry, port, chatId, currentTags, onReload],
  );

  const rename = useCallback(
    (from: string, to: string) =>
      run('Rename', async () => {
        if (to === from || validateTagName(to) !== null) return;
        await registry.update(from, { rename: to });
        cascade(from, to);
      }),
    [run, registry, cascade],
  );

  const recolor = useCallback(
    (name: string, color: TagColor) => run('Recolor', () => registry.update(name, { color })),
    [run, registry],
  );

  const remove = useCallback(
    (name: string) =>
      run('Delete', async () => {
        await registry.remove(name);
        cascade(name, null);
      }),
    [run, registry, cascade],
  );

  return { error, clearError, toggle, createAndApply, rename, recolor, remove };
}
