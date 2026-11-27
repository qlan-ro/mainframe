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
 * Only text that has stopped changing belongs here: a streaming reply parses its newest block again
 * on every frame, and keeping each of those versions would push out the rows that come back.
 */
import type { Root } from 'mdast';
import type { Parser, Plugin, PluggableList, Processor } from 'unified';

/**
 * Estimated heap per character of source for a kept entry: the tree's nodes and positions (about
 * 29 bytes per character, measured in V8 on mixed prose, lists, tables and code) plus its key.
 */
export const TREE_BYTES_PER_CHAR = 32;
export const PARSE_CACHE_BUDGET_BYTES = 16 * 1024 * 1024;

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
    const bytes = key.length * TREE_BYTES_PER_CHAR;
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

let keySpaces = 0;
const withCache = new WeakMap<MarkdownParseCache, WeakMap<PluggableList, PluggableList>>();

/**
 * `plugins` plus a plugin that serves the parse from `cache`. Each list gets its own key space,
 * because its plugins decide the syntax (GFM tables, footnotes) and so the tree. The result is
 * memoized per list and cache: Streamdown keeps a block's render while its `remarkPlugins` stay the same object.
 */
export function withParseCache(plugins: PluggableList, cache = markdownParseCache): PluggableList {
  let lists = withCache.get(cache);
  if (!lists) withCache.set(cache, (lists = new WeakMap()));
  const memo = lists.get(plugins);
  if (memo) return memo;
  const scope = `${++keySpaces}\0`;
  // Runs after remark-parse has set the parser, wherever it sits in the list.
  const cacheParse: Plugin<[], Root> = function (this: Processor) {
    const parse = this.parser as Parser<Root> | undefined;
    if (!parse) return;
    this.parser = (doc, file) => {
      const key = scope + doc;
      const kept = cache.take(key);
      if (kept) return kept;
      const tree = parse(doc, file);
      cache.keep(key, tree);
      return tree;
    };
  };
  const list = [...plugins, cacheParse];
  lists.set(plugins, list);
  return list;
}
