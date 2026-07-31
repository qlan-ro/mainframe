/**
 * `@`-mention trigger adapter — desktop-parity, mode-aware.
 *
 * The trigger engine calls `search(body)` where `body` is the text after `@`
 * (whitespace-bounded, slashes included). We classify it the same way
 * desktop's `parseAtToken` does:
 *   - no slash → FUZZY: agents (from the preloaded provider list) +
 *     referenceable sessions (from the caller) + project file fuzzy-search
 *     (`searchFiles`).
 *   - `dir/leaf` where dir is `/…` or `~…` → FILESYSTEM autocomplete
 *     (`browseFilesystem`) — browses the real filesystem.
 *   - `dir/leaf` otherwise → PROJECT-TREE autocomplete (`getFileTree`).
 *
 * Async sources are bridged to the synchronous adapter via a query-keyed cache
 * (mirrors the original file cache): `request(body)` fires the right fetch once
 * per key and notifies subscribers; `getItems(body)` reads the cache synchronously.
 *
 * Directory items keep the `@dir/` token OPEN for drill-down (see
 * `mentionDirectiveFormatter`); files/agents close it.
 */
import type { AgentConfig } from '@qlan-ro/mainframe-types';
import type { FileResult, FileTreeEntry } from '@/lib/api/files';
import type { TriggerAdapter, TriggerItem } from '@/components/trigger-engine/types';

// ---------------------------------------------------------------------------
// Token classification (mirrors desktop parse-at-token body logic + isFilesystemDir)
// ---------------------------------------------------------------------------

type Classified =
  | { mode: 'fuzzy'; query: string }
  | { mode: 'tree'; dir: string; leaf: string }
  | { mode: 'fs'; dir: string; leaf: string };

export function classifyMention(body: string): Classified {
  const lastSlash = body.lastIndexOf('/');
  if (lastSlash === -1) return { mode: 'fuzzy', query: body };
  const rawDir = body.slice(0, lastSlash);
  const dir = rawDir !== '' ? rawDir : body.startsWith('/') ? '/' : '.';
  const leaf = body.slice(lastSlash + 1);
  return dir.startsWith('/') || dir.startsWith('~') ? { mode: 'fs', dir, leaf } : { mode: 'tree', dir, leaf };
}

const fileItem = (f: FileResult): TriggerItem => ({
  id: f.path,
  type: 'file',
  label: f.name,
  description: f.path,
});
const treeItem = (e: FileTreeEntry): TriggerItem => ({
  id: e.path,
  type: e.type === 'directory' ? 'directory' : 'file',
  label: e.name,
  description: e.path,
});
const agentItem = (a: AgentConfig): TriggerItem => ({
  id: a.name,
  type: 'agent',
  label: a.name,
  description: a.description,
});

// ---------------------------------------------------------------------------
// Cache (async sources → sync reads)
// ---------------------------------------------------------------------------

export interface MentionCacheDeps {
  searchFiles: (q: string) => Promise<FileResult[]>;
  getFileTree: (dir: string) => Promise<FileTreeEntry[]>;
  browseFilesystem: (dir: string) => Promise<FileTreeEntry[]>;
}

export interface MentionCache {
  /** Items for the parsed body, read synchronously from cache (agents merged by the adapter). */
  getItems(body: string): TriggerItem[];
  /** Kick off the fetch for the parsed body (deduped per key); no-op for an empty fuzzy query. */
  request(body: string): void;
  subscribe(listener: () => void): () => void;
}

/** Cache key + fetch for a classified body. Null = nothing to fetch (empty fuzzy). */
function fetchPlan(deps: MentionCacheDeps, c: Classified): { key: string; run: () => Promise<TriggerItem[]> } | null {
  if (c.mode === 'fuzzy') {
    if (c.query === '') return null; // bare `@` → no file fetch (agents only)
    return { key: `f:${c.query}`, run: () => deps.searchFiles(c.query).then((r) => r.map(fileItem)) };
  }
  if (c.mode === 'fs')
    return { key: `b:${c.dir}`, run: () => deps.browseFilesystem(c.dir).then((r) => r.map(treeItem)) };
  return { key: `t:${c.dir}`, run: () => deps.getFileTree(c.dir).then((r) => r.map(treeItem)) };
}

export function createMentionCache(deps: MentionCacheDeps): MentionCache {
  const cache = new Map<string, TriggerItem[]>();
  const inflight = new Set<string>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  return {
    request: (body) => {
      const plan = fetchPlan(deps, classifyMention(body));
      if (!plan || cache.has(plan.key) || inflight.has(plan.key)) return;
      inflight.add(plan.key);
      plan.run().then(
        (items) => {
          cache.set(plan.key, items);
          inflight.delete(plan.key);
          emit();
        },
        (err: unknown) => {
          console.warn('[mention] fetch failed', err);
          inflight.delete(plan.key);
        },
      );
    },
    getItems: (body) => {
      const c = classifyMention(body);
      const plan = fetchPlan(deps, c);
      const items = plan ? (cache.get(plan.key) ?? []) : [];
      // Autocomplete: filter the cached directory listing by the current leaf.
      if (c.mode === 'tree' || c.mode === 'fs') {
        const leaf = c.leaf.toLowerCase();
        return leaf ? items.filter((it) => it.label.toLowerCase().startsWith(leaf)) : items;
      }
      return items;
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/** Stable identity — an inline `[]` default would churn the adapter memo every render. */
export const NO_SESSIONS: readonly TriggerItem[] = [];

/**
 * Search-first adapter (no categories) merging agents and referenceable sessions
 * (fuzzy mode only) with the cached file/dir results.
 *
 * Sessions arrive pre-ordered and pre-disambiguated by their source hook, so the
 * adapter filters them but never re-sorts: the order the picker shows is the one
 * the labels were made unique against.
 */
export function buildMentionTriggerAdapter(
  cache: MentionCache,
  agents: AgentConfig[],
  sessions: readonly TriggerItem[] = NO_SESSIONS,
): TriggerAdapter {
  const items = (body: string): TriggerItem[] => {
    cache.request(body);
    const cached = cache.getItems(body);
    const c = classifyMention(body);
    if (c.mode !== 'fuzzy') return cached;
    const q = c.query.toLowerCase();
    const matched = agents.filter((a) => !q || a.name.toLowerCase().includes(q)).map(agentItem);
    const matchedSessions = sessions.filter((s) => !q || s.label.toLowerCase().includes(q));
    return [...matched, ...matchedSessions, ...cached];
  };
  return {
    categories: () => [],
    categoryItems: () => items(''),
    search: (q) => items(q),
  };
}
