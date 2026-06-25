import { describe, it, expect, vi } from 'vitest';
import { classifyMention, createMentionCache, buildMentionTriggerAdapter } from '../mention-adapter';
import type { MentionCacheDeps } from '../mention-adapter';
import type { FileResult, FileTreeEntry } from '@/lib/api/files';
import type { AgentConfig } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// classifyMention
// ---------------------------------------------------------------------------

describe('classifyMention', () => {
  it("empty string → mode:'fuzzy', query:''", () => {
    expect(classifyMention('')).toEqual({ mode: 'fuzzy', query: '' });
  });

  it("plain word → mode:'fuzzy', query:'foo'", () => {
    expect(classifyMention('foo')).toEqual({ mode: 'fuzzy', query: 'foo' });
  });

  it("'src/comp' → mode:'tree', dir:'src', leaf:'comp'", () => {
    expect(classifyMention('src/comp')).toEqual({ mode: 'tree', dir: 'src', leaf: 'comp' });
  });

  it("'src/' → mode:'tree', dir:'src', leaf:''", () => {
    expect(classifyMention('src/')).toEqual({ mode: 'tree', dir: 'src', leaf: '' });
  });

  it("'/Users/x/' → mode:'fs', dir:'/Users/x', leaf:''", () => {
    expect(classifyMention('/Users/x/')).toEqual({ mode: 'fs', dir: '/Users/x', leaf: '' });
  });

  it("'/foo' (lastSlash=0, rawDir='') → mode:'fs', dir:'/', leaf:'foo'", () => {
    expect(classifyMention('/foo')).toEqual({ mode: 'fs', dir: '/', leaf: 'foo' });
  });

  it("'~/Doc' → mode:'fs', dir:'~', leaf:'Doc'", () => {
    expect(classifyMention('~/Doc')).toEqual({ mode: 'fs', dir: '~', leaf: 'Doc' });
  });

  it("'a/b/c' → mode:'tree', dir:'a/b', leaf:'c'", () => {
    expect(classifyMention('a/b/c')).toEqual({ mode: 'tree', dir: 'a/b', leaf: 'c' });
  });
});

// ---------------------------------------------------------------------------
// createMentionCache
// ---------------------------------------------------------------------------

const fileFixtures: FileResult[] = [
  { name: 'alpha.ts', path: 'src/alpha.ts', type: 'file', exact: false },
  { name: 'beta.ts', path: 'src/beta.ts', type: 'file', exact: false },
];

const treeFixtures: FileTreeEntry[] = [
  { name: 'components', type: 'directory', path: 'src/components' },
  { name: 'config.ts', type: 'file', path: 'src/config.ts' },
];

function makeControlledPromise<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeDeps(): {
  deps: MentionCacheDeps;
  searchFiles: ReturnType<typeof vi.fn>;
  getFileTree: ReturnType<typeof vi.fn>;
  browseFilesystem: ReturnType<typeof vi.fn>;
} {
  const searchFiles = vi.fn();
  const getFileTree = vi.fn();
  const browseFilesystem = vi.fn();
  return { deps: { searchFiles, getFileTree, browseFilesystem }, searchFiles, getFileTree, browseFilesystem };
}

describe('createMentionCache', () => {
  describe("request('') — empty fuzzy", () => {
    it('does not call any fetcher and getItems returns []', () => {
      const { deps, searchFiles, getFileTree, browseFilesystem } = makeDeps();
      const cache = createMentionCache(deps);

      cache.request('');

      expect(searchFiles).not.toHaveBeenCalled();
      expect(getFileTree).not.toHaveBeenCalled();
      expect(browseFilesystem).not.toHaveBeenCalled();
      expect(cache.getItems('')).toEqual([]);
    });
  });

  describe("request('foo') — fuzzy, non-empty", () => {
    it('calls searchFiles once and getItems returns [] before resolve', () => {
      const { deps, searchFiles } = makeDeps();
      const { promise } = makeControlledPromise<FileResult[]>();
      searchFiles.mockReturnValue(promise);
      const cache = createMentionCache(deps);

      cache.request('foo');

      expect(searchFiles).toHaveBeenCalledOnce();
      expect(searchFiles).toHaveBeenCalledWith('foo');
      expect(cache.getItems('foo')).toEqual([]);
    });

    it('getItems returns mapped items after fetch resolves', async () => {
      const { deps, searchFiles } = makeDeps();
      const { promise, resolve } = makeControlledPromise<FileResult[]>();
      searchFiles.mockReturnValue(promise);
      const cache = createMentionCache(deps);

      cache.request('foo');
      resolve(fileFixtures);
      await promise;
      // allow microtask queue to flush
      await Promise.resolve();

      expect(cache.getItems('foo')).toEqual([
        { id: 'src/alpha.ts', type: 'file', label: 'alpha.ts', description: 'src/alpha.ts' },
        { id: 'src/beta.ts', type: 'file', label: 'beta.ts', description: 'src/beta.ts' },
      ]);
    });

    it('dedup: two request calls → searchFiles called once', async () => {
      const { deps, searchFiles } = makeDeps();
      const { promise, resolve } = makeControlledPromise<FileResult[]>();
      searchFiles.mockReturnValue(promise);
      const cache = createMentionCache(deps);

      cache.request('foo');
      cache.request('foo');
      resolve(fileFixtures);
      await promise;
      await Promise.resolve();

      expect(searchFiles).toHaveBeenCalledOnce();
    });

    it('subscribe listener fires after fetch resolves', async () => {
      const { deps, searchFiles } = makeDeps();
      const { promise, resolve } = makeControlledPromise<FileResult[]>();
      searchFiles.mockReturnValue(promise);
      const cache = createMentionCache(deps);
      const listener = vi.fn();
      cache.subscribe(listener);

      cache.request('foo');
      expect(listener).not.toHaveBeenCalled();

      resolve(fileFixtures);
      await promise;
      await Promise.resolve();

      expect(listener).toHaveBeenCalledOnce();
    });

    it('subscribe returns an unsubscribe fn that stops notifications', async () => {
      const { deps, searchFiles } = makeDeps();
      const { promise, resolve } = makeControlledPromise<FileResult[]>();
      searchFiles.mockReturnValue(promise);
      const cache = createMentionCache(deps);
      const listener = vi.fn();
      const unsub = cache.subscribe(listener);
      unsub();

      cache.request('foo');
      resolve(fileFixtures);
      await promise;
      await Promise.resolve();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("request('src/') — tree mode", () => {
    it('calls getFileTree with dir (not browseFilesystem)', () => {
      const { deps, getFileTree, browseFilesystem } = makeDeps();
      const { promise } = makeControlledPromise<FileTreeEntry[]>();
      getFileTree.mockReturnValue(promise);
      const cache = createMentionCache(deps);

      cache.request('src/');

      expect(getFileTree).toHaveBeenCalledOnce();
      expect(getFileTree).toHaveBeenCalledWith('src');
      expect(browseFilesystem).not.toHaveBeenCalled();
    });

    it('getItems maps directory and file entries with correct type', async () => {
      const { deps, getFileTree } = makeDeps();
      const { promise, resolve } = makeControlledPromise<FileTreeEntry[]>();
      getFileTree.mockReturnValue(promise);
      const cache = createMentionCache(deps);

      cache.request('src/');
      resolve(treeFixtures);
      await promise;
      await Promise.resolve();

      expect(cache.getItems('src/')).toEqual([
        { id: 'src/components', type: 'directory', label: 'components', description: 'src/components' },
        { id: 'src/config.ts', type: 'file', label: 'config.ts', description: 'src/config.ts' },
      ]);
    });

    it("getItems('src/comp') filters cached 'src' listing by name startsWith 'comp' (case-insensitive)", async () => {
      const { deps, getFileTree } = makeDeps();
      const { promise, resolve } = makeControlledPromise<FileTreeEntry[]>();
      getFileTree.mockReturnValue(promise);
      const cache = createMentionCache(deps);

      cache.request('src/');
      resolve(treeFixtures);
      await promise;
      await Promise.resolve();

      // 'comp' matches 'components' but not 'config.ts' by startsWith
      expect(cache.getItems('src/comp')).toEqual([
        { id: 'src/components', type: 'directory', label: 'components', description: 'src/components' },
      ]);
    });

    it("getItems('src/CON') is case-insensitive when filtering", async () => {
      const { deps, getFileTree } = makeDeps();
      const { promise, resolve } = makeControlledPromise<FileTreeEntry[]>();
      getFileTree.mockReturnValue(promise);
      const cache = createMentionCache(deps);

      cache.request('src/');
      resolve(treeFixtures);
      await promise;
      await Promise.resolve();

      // 'CON' lowercased = 'con' — 'config.ts' starts with 'con', 'components' starts with 'com' → only config.ts matches
      expect(cache.getItems('src/CON')).toEqual([
        { id: 'src/config.ts', type: 'file', label: 'config.ts', description: 'src/config.ts' },
      ]);
    });

    it("requesting 'src/comp' after 'src/' does NOT refetch — getFileTree called once", async () => {
      const { deps, getFileTree } = makeDeps();
      const { promise, resolve } = makeControlledPromise<FileTreeEntry[]>();
      getFileTree.mockReturnValue(promise);
      const cache = createMentionCache(deps);

      cache.request('src/');
      resolve(treeFixtures);
      await promise;
      await Promise.resolve();

      // Both 'src/' and 'src/comp' map to key 't:src' — no second fetch
      cache.request('src/comp');

      expect(getFileTree).toHaveBeenCalledOnce();
    });
  });

  describe("request('/Users/x/') — fs mode", () => {
    it('calls browseFilesystem with dir (not getFileTree)', () => {
      const { deps, getFileTree, browseFilesystem } = makeDeps();
      const { promise } = makeControlledPromise<FileTreeEntry[]>();
      browseFilesystem.mockReturnValue(promise);
      const cache = createMentionCache(deps);

      cache.request('/Users/x/');

      expect(browseFilesystem).toHaveBeenCalledOnce();
      expect(browseFilesystem).toHaveBeenCalledWith('/Users/x');
      expect(getFileTree).not.toHaveBeenCalled();
    });

    it('getItems returns mapped filesystem entries after resolve', async () => {
      const { deps, browseFilesystem } = makeDeps();
      const fsFixtures: FileTreeEntry[] = [
        { name: 'Documents', type: 'directory', path: '/Users/x/Documents' },
        { name: 'notes.txt', type: 'file', path: '/Users/x/notes.txt' },
      ];
      const { promise, resolve } = makeControlledPromise<FileTreeEntry[]>();
      browseFilesystem.mockReturnValue(promise);
      const cache = createMentionCache(deps);

      cache.request('/Users/x/');
      resolve(fsFixtures);
      await promise;
      await Promise.resolve();

      expect(cache.getItems('/Users/x/')).toEqual([
        { id: '/Users/x/Documents', type: 'directory', label: 'Documents', description: '/Users/x/Documents' },
        { id: '/Users/x/notes.txt', type: 'file', label: 'notes.txt', description: '/Users/x/notes.txt' },
      ]);
    });
  });
});

// ---------------------------------------------------------------------------
// buildMentionTriggerAdapter
// ---------------------------------------------------------------------------

const agentFixtures: AgentConfig[] = [
  {
    id: 'a1',
    adapterId: 'claude',
    name: 'foo-agent',
    description: 'An agent that does foo',
    scope: 'global',
    filePath: '/agents/foo-agent.md',
    content: '# Foo Agent',
  },
  {
    id: 'a2',
    adapterId: 'claude',
    name: 'bar-helper',
    description: 'Helps with bar tasks',
    scope: 'project',
    filePath: '/agents/bar-helper.md',
    content: '# Bar Helper',
  },
];

describe('buildMentionTriggerAdapter', () => {
  it('categories() returns []', () => {
    const { deps } = makeDeps();
    const cache = createMentionCache(deps);
    const adapter = buildMentionTriggerAdapter(cache, agentFixtures);
    expect(adapter.categories()).toEqual([]);
  });

  describe("search('') — bare @ (empty fuzzy)", () => {
    it('returns all agents mapped to TriggerItems and no file items', () => {
      const { deps } = makeDeps();
      const cache = createMentionCache(deps);
      const adapter = buildMentionTriggerAdapter(cache, agentFixtures);

      const results = adapter.search!('');

      expect(results).toEqual([
        { id: 'foo-agent', type: 'agent', label: 'foo-agent', description: 'An agent that does foo' },
        { id: 'bar-helper', type: 'agent', label: 'bar-helper', description: 'Helps with bar tasks' },
      ]);
    });
  });

  describe("search('foo') — fuzzy with query", () => {
    it('returns only agents whose name includes query (case-insensitive) when no file cache', () => {
      const { deps } = makeDeps();
      // searchFiles never resolves → cached file items stay []
      deps.searchFiles = vi.fn().mockReturnValue(new Promise(() => undefined));
      const cache = createMentionCache(deps);
      const adapter = buildMentionTriggerAdapter(cache, agentFixtures);

      const results = adapter.search!('foo');

      // 'foo-agent' matches, 'bar-helper' does not
      expect(results).toEqual([
        { id: 'foo-agent', type: 'agent', label: 'foo-agent', description: 'An agent that does foo' },
      ]);
    });

    it('agent items appear before cached file items', async () => {
      const { deps } = makeDeps();
      const { promise, resolve } = makeControlledPromise<FileResult[]>();
      deps.searchFiles = vi.fn().mockReturnValue(promise);
      const cache = createMentionCache(deps);

      // Seed file cache first
      cache.request('foo');
      resolve(fileFixtures);
      await promise;
      await Promise.resolve();

      const adapter = buildMentionTriggerAdapter(cache, agentFixtures);
      const results = adapter.search!('foo');

      // Agent items (those matching 'foo') must precede file items
      const agentIdx = results.findIndex((r) => r.type === 'agent');
      const fileIdx = results.findIndex((r) => r.type === 'file');

      expect(agentIdx).toBeLessThan(fileIdx);
      expect(results[0]).toEqual({
        id: 'foo-agent',
        type: 'agent',
        label: 'foo-agent',
        description: 'An agent that does foo',
      });
    });

    it("'BAR' matches bar-helper case-insensitively", () => {
      const { deps } = makeDeps();
      deps.searchFiles = vi.fn().mockReturnValue(new Promise(() => undefined));
      const cache = createMentionCache(deps);
      const adapter = buildMentionTriggerAdapter(cache, agentFixtures);

      const results = adapter.search!('BAR');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: 'bar-helper',
        type: 'agent',
        label: 'bar-helper',
        description: 'Helps with bar tasks',
      });
    });

    it("'zzz-no-match' returns no agents", () => {
      const { deps } = makeDeps();
      deps.searchFiles = vi.fn().mockReturnValue(new Promise(() => undefined));
      const cache = createMentionCache(deps);
      const adapter = buildMentionTriggerAdapter(cache, agentFixtures);

      const results = adapter.search!('zzz-no-match');

      const agentResults = results.filter((r) => r.type === 'agent');
      expect(agentResults).toHaveLength(0);
    });
  });

  describe("search('src/') — autocomplete (tree mode)", () => {
    it('returns only cache items — no agent items merged', async () => {
      const { deps, getFileTree } = makeDeps();
      const { promise, resolve } = makeControlledPromise<FileTreeEntry[]>();
      getFileTree.mockReturnValue(promise);
      const cache = createMentionCache(deps);

      // Seed the tree cache
      cache.request('src/');
      resolve(treeFixtures);
      await promise;
      await Promise.resolve();

      const adapter = buildMentionTriggerAdapter(cache, agentFixtures);
      const results = adapter.search!('src/');

      const agentResults = results.filter((r) => r.type === 'agent');
      expect(agentResults).toHaveLength(0);

      expect(results).toEqual([
        { id: 'src/components', type: 'directory', label: 'components', description: 'src/components' },
        { id: 'src/config.ts', type: 'file', label: 'config.ts', description: 'src/config.ts' },
      ]);
    });
  });
});
