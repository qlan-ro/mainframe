/**
 * Parsed markdown, kept across mounts.
 *
 * A switch back to a chat mounts its rows again, and every settled block of every reply and every
 * user bubble went through the markdown parser again: on a back leg in WKWebView that was about a
 * third of the transcript's render time. A parse depends only on the text and the syntax the
 * plugin list adds, so a settled block's tree is kept under a byte budget, keyed by its text.
 *
 * The transformers that run after the parse (`remarkAppLinks`, the smart-action spans, Streamdown's
 * html-as-text pass) edit the tree in place, so the cache holds a pristine copy and every read gets
 * its own clone.
 *
 * Only text that has stopped changing is kept: a streaming reply parses its newest block again on
 * every frame, and keeping each of those versions would push out the rows that come back. The
 * block still growing reads the cache through `withoutKeep` (`parse-cache-block.tsx`), so a part
 * holds one plugin list for its whole life and settling re-renders that one block, not the reply.
 */
import type { Root } from 'mdast';
import type { Parser, Plugin, PluggableList, Processor } from 'unified';

/**
 * A kept entry's estimated heap: per tree node (the node, its position and children array) and per
 * character of its key (the key string and the text values). Fitted in V8 on prose, flat and nested
 * lists, tables and code; the fit is within 8% for each. Per character alone it ranges from 4
 * bytes (code: one node) to 117 (tables), so the estimate counts nodes.
 */
export const BYTES_PER_NODE = 300;
export const BYTES_PER_CHAR = 4;
export const PARSE_CACHE_BUDGET_BYTES = 16 * 1024 * 1024;

type TreeNode = { readonly children?: readonly unknown[] };

/** The estimate above, for one entry. */
export function entryBytes(key: string, tree: Root): number {
  let nodes = 0;
  const stack: TreeNode[] = [tree];
  for (let node = stack.pop(); node; node = stack.pop()) {
    nodes += 1;
    if (node.children) stack.push(...(node.children as TreeNode[]));
  }
  return nodes * BYTES_PER_NODE + key.length * BYTES_PER_CHAR;
}

interface Kept {
  readonly tree: Root;
  readonly bytes: number;
}

export class MarkdownParseCache {
  /** Oldest read first: iteration order is the eviction order. */
  private readonly trees = new Map<string, Kept>();
  private total = 0;

  constructor(private readonly budget = PARSE_CACHE_BUDGET_BYTES) {}

  get bytes(): number {
    return this.total;
  }

  get size(): number {
    return this.trees.size;
  }

  /** A fresh copy of the kept tree, or undefined. A read makes the entry the newest. */
  take(key: string): Root | undefined {
    const kept = this.trees.get(key);
    if (!kept) return undefined;
    this.trees.delete(key);
    this.trees.set(key, kept);
    return structuredClone(kept.tree);
  }

  /** Keeps a copy of `tree`, then drops the oldest entries until the cache fits its budget again. */
  keep(key: string, tree: Root): void {
    const bytes = entryBytes(key, tree);
    if (bytes > this.budget) return;
    this.drop(key);
    this.trees.set(key, { tree: structuredClone(tree), bytes });
    this.total += bytes;
    for (const oldest of this.trees.keys()) {
      if (this.total <= this.budget) break;
      this.drop(oldest);
    }
  }

  clear(): void {
    this.trees.clear();
    this.total = 0;
  }

  private drop(key: string): void {
    const kept = this.trees.get(key);
    if (!kept) return;
    this.trees.delete(key);
    this.total -= kept.bytes;
  }
}

export const markdownParseCache = new MarkdownParseCache();

interface CachePlugins {
  readonly keep: Plugin<[], Root>;
  readonly readOnly: Plugin<[], Root>;
}

const plugins = new WeakMap<MarkdownParseCache, CachePlugins>();
const ownPlugins = new WeakSet<object>();
const readOnlyOf = new WeakMap<object, Plugin<[], Root>>();
const pluginIds = new WeakMap<object, number>();
const keySpaces = new Map<string, string>();
let nextId = 0;

function idOf(value: object): number {
  let id = pluginIds.get(value);
  if (id === undefined) pluginIds.set(value, (id = ++nextId));
  return id;
}

/**
 * The key space of a processor: every plugin it runs and its options, in order, except the cache's
 * own. It is read from the processor itself, so it covers what Streamdown or react-markdown add
 * to the caller's list (remark-parse, Streamdown's cjk, math and literal-tag plugins, remark-rehype),
 * not just the list the caller passed. `null` when an option cannot be written down: no caching.
 */
function keySpace(attachers: readonly (readonly unknown[])[]): string | null {
  const parts: string[] = [];
  for (const [plugin, ...options] of attachers) {
    if (typeof plugin !== 'function' || ownPlugins.has(plugin)) continue;
    try {
      const written = JSON.stringify(options, (_key, value: unknown) =>
        typeof value === 'function' ? `fn${idOf(value)}` : value instanceof RegExp ? String(value) : value,
      );
      parts.push(`${idOf(plugin)}:${written}`);
    } catch {
      return null;
    }
  }
  const signature = parts.join('|');
  let space = keySpaces.get(signature);
  if (space === undefined) keySpaces.set(signature, (space = `${keySpaces.size + 1}\0`));
  return space;
}

function cachePlugin(cache: MarkdownParseCache, keep: boolean): Plugin<[], Root> {
  // Runs after remark-parse has set the parser, wherever it sits in the list.
  const plugin: Plugin<[], Root> = function (this: Processor) {
    const parse = this.parser as Parser<Root> | undefined;
    const space = parse ? keySpace(this.attachers) : null;
    if (!parse || space === null) return;
    this.parser = (doc, file) => {
      const key = space + doc;
      const kept = cache.take(key);
      if (kept) return kept;
      const tree = parse(doc, file);
      if (keep) cache.keep(key, tree);
      return tree;
    };
  };
  ownPlugins.add(plugin);
  return plugin;
}

function pluginsFor(cache: MarkdownParseCache): CachePlugins {
  let pair = plugins.get(cache);
  if (!pair) {
    pair = { keep: cachePlugin(cache, true), readOnly: cachePlugin(cache, false) };
    readOnlyOf.set(pair.keep, pair.readOnly);
    plugins.set(cache, pair);
  }
  return pair;
}

const withCache = new WeakMap<MarkdownParseCache, WeakMap<PluggableList, PluggableList>>();
const readOnlyLists = new WeakMap<PluggableList, PluggableList>();

/**
 * `list` plus the plugin that serves the parse from `cache` and keeps what it parses. Memoized per
 * list and cache: Streamdown keeps a block's render while its `remarkPlugins` stay the same object.
 */
export function withParseCache(list: PluggableList, cache = markdownParseCache): PluggableList {
  let lists = withCache.get(cache);
  if (!lists) withCache.set(cache, (lists = new WeakMap()));
  let cached = lists.get(list);
  if (!cached) lists.set(list, (cached = [...list, pluginsFor(cache).keep]));
  return cached;
}

/**
 * The same list reading the cache without adding to it, for text that is still growing. Same key
 * space, so a block that settles finds what an earlier mount kept. Memoized per list.
 */
export function withoutKeep(list: PluggableList): PluggableList {
  let readOnly = readOnlyLists.get(list);
  if (!readOnly) {
    const swapped = list.map((plugin) => readOnlyOf.get(plugin as object) ?? plugin);
    readOnly = swapped.some((plugin, index) => plugin !== list[index]) ? swapped : list;
    readOnlyLists.set(list, readOnly);
  }
  return readOnly;
}
