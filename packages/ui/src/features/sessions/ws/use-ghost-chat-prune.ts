/**
 * useGhostChatPrune — extracted out of useSessionListRouter to keep that hook
 * under the file's line budget (todo #346).
 *
 * Reconciles the persistent discarded-chat set (`ghost-chat-queue.ts`) against
 * the live `items` list on every change: any discarded id that has appeared in
 * `items` gets its local entry removed via `threads.item(id).delete()`, and is
 * cleared from the set only once that delete succeeds. An id not yet present
 * in `items` (a stale in-flight reload hasn't caught up) simply stays in the
 * set for the next `items` change to retry — nothing is dropped on the floor.
 *
 * The daemon copy is already gone by the time this runs, so `stageLocalOnlyRemoval`
 * tells the adapter to skip hitting it again — this is a client-state-only
 * removal, not a second discard request.
 */
import { useEffect, useRef } from 'react';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { stageLocalOnlyRemoval, takeLocalOnlyRemoval } from '../runtime/archive-confirm-bridge';
import { clearDiscardedChatId, getDiscardedChatIds } from '../runtime/ghost-chat-queue';

/**
 * The slice of `useAui().threads` (the store client's "ThreadsMethods"
 * accessor, not exported by name from `@assistant-ui/react` — see
 * SessionRowItemScope.tsx for the same constraint) this hook needs.
 * `item({id}).delete()` is typed `void` on that surface but the client wires
 * it straight through to the underlying `ThreadListItemRuntime.delete()`,
 * which DOES return the promise `await` actually waits on at runtime
 * (verified against the installed source, `thread-list-item-runtime-client.ts`).
 */
export interface GhostChatPruneThreads {
  item(query: { id: string }): { delete(): unknown };
}

export function useGhostChatPrune(items: readonly SessionItem[], threads: GhostChatPruneThreads): void {
  // Guards against re-firing delete() for an id whose prune is already
  // in-flight across back-to-back `items` changes (e.g. two reloads landing
  // close together) — a persistent set alone doesn't track "in progress".
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const id of getDiscardedChatIds()) {
      if (inFlightRef.current.has(id)) continue;
      if (!items.some((t) => t.id === id)) continue; // not (yet) in this list — retry on the next items change
      inFlightRef.current.add(id);
      stageLocalOnlyRemoval(id);
      void (async () => {
        try {
          await threads.item({ id }).delete();
          clearDiscardedChatId(id);
        } catch (err: unknown) {
          takeLocalOnlyRemoval(id); // never consumed — clear it so it can't leak onto an unrelated later call
          console.warn('[useGhostChatPrune] ghost-chat prune failed', { id, err });
        } finally {
          inFlightRef.current.delete(id);
        }
      })();
    }
  }, [items, threads]);
}
