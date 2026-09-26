/**
 * Resolves a fork's parent chat when it isn't in the sidebar's loaded item
 * set at all (`classifyParent` returned `'unresolved'`). The sidebar only
 * loads regular, non-archived chats (`regularThreadItemsToSessionItems`), so
 * a parent missing from that set is either archived or deleted — this is the
 * one place that asks the daemon directly, via `GET /api/chats/:id`.
 *
 * Fetched once per parent id and cached at module scope (not per-hook-instance
 * state), so a parent referenced by several fork rows — or by both a sidebar
 * row and the chat header — makes exactly one request.
 */
import { useEffect, useState } from 'react';
import { getChat } from '@/lib/api/chats';
import { ApiRequestError } from '@/lib/api/http';
import { useDaemonPort } from './runtime/daemon-port-context';

export type ExternalParentChat = { kind: 'loading' } | { kind: 'archived'; title?: string } | { kind: 'deleted' };

const cache = new Map<string, ExternalParentChat>();
const listeners = new Map<string, Set<() => void>>();
const inflight = new Set<string>();

function notify(id: string): void {
  for (const fn of listeners.get(id) ?? []) fn();
}

function fetchOnce(port: number, id: string): void {
  if (cache.has(id) || inflight.has(id)) return;
  inflight.add(id);
  getChat(port, id)
    .then((chat) => {
      // A found, non-archived chat is a transient race (e.g. the list hasn't
      // caught up yet) — there's nothing wrong to report, so stay 'loading'
      // rather than inventing a fourth lineage state no spec Hint covers.
      cache.set(id, chat.status === 'archived' ? { kind: 'archived', title: chat.title } : { kind: 'loading' });
    })
    .catch((err: unknown) => {
      const status = err instanceof ApiRequestError ? err.status : 0;
      cache.set(id, status === 404 ? { kind: 'deleted' } : { kind: 'loading' });
    })
    .finally(() => {
      inflight.delete(id);
      notify(id);
    });
}

export function useParentChat(parentChatId: string | null | undefined): ExternalParentChat | undefined {
  const port = useDaemonPort();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (parentChatId == null) return;
    let entry = listeners.get(parentChatId);
    if (entry == null) {
      entry = new Set();
      listeners.set(parentChatId, entry);
    }
    const rerender = () => setTick((n) => n + 1);
    entry.add(rerender);
    fetchOnce(port, parentChatId);
    return () => {
      entry?.delete(rerender);
    };
  }, [parentChatId, port]);

  return parentChatId == null ? undefined : cache.get(parentChatId);
}

/** Test-only: the cache is module-scoped, so suites that assert on fetch counts must reset it. */
export function __resetParentChatCacheForTests(): void {
  cache.clear();
  listeners.clear();
  inflight.clear();
}
