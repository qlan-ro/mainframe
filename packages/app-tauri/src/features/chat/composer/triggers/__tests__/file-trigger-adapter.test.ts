import { describe, it, expect, vi } from 'vitest';
import { createFileSearchCache, buildFileTriggerAdapter } from '../file-trigger-adapter';
import type { FileResult } from '@/lib/api/files';

const fileFixtures: FileResult[] = [
  { name: 'index.ts', path: 'src/index.ts', type: 'file', exact: true },
  { name: 'utils.ts', path: 'src/lib/utils.ts', type: 'file', exact: false },
];

const expectedItems = [
  { id: 'src/index.ts', type: 'file', label: 'index.ts', description: 'src/index.ts' },
  { id: 'src/lib/utils.ts', type: 'file', label: 'utils.ts', description: 'src/lib/utils.ts' },
];

describe('createFileSearchCache', () => {
  it('getItems returns [] before any request', () => {
    const fetcher = vi.fn().mockResolvedValue(fileFixtures);
    const cache = createFileSearchCache(fetcher);
    expect(cache.getItems('foo')).toEqual([]);
  });

  it('getItems returns mapped items after request resolves', async () => {
    let resolve!: (v: FileResult[]) => void;
    const promise = new Promise<FileResult[]>((r) => {
      resolve = r;
    });
    const fetcher = vi.fn().mockReturnValue(promise);
    const cache = createFileSearchCache(fetcher);

    cache.request('foo');
    expect(cache.getItems('foo')).toEqual([]); // not yet resolved

    resolve(fileFixtures);
    await promise;

    expect(cache.getItems('foo')).toEqual(expectedItems);
  });

  it('request calls fetcher only once for the same query', async () => {
    const fetcher = vi.fn().mockResolvedValue(fileFixtures);
    const cache = createFileSearchCache(fetcher);

    cache.request('foo');
    cache.request('foo');
    cache.request('foo');

    // Wait for all microtasks
    await Promise.resolve();
    await Promise.resolve();

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('request does not call fetcher again for a cached query', async () => {
    const fetcher = vi.fn().mockResolvedValue(fileFixtures);
    const cache = createFileSearchCache(fetcher);

    cache.request('bar');
    await Promise.resolve();
    await Promise.resolve();

    cache.request('bar'); // already cached
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('subscribe listener is called when results land', async () => {
    const fetcher = vi.fn().mockResolvedValue(fileFixtures);
    const cache = createFileSearchCache(fetcher);
    const listener = vi.fn();
    cache.subscribe(listener);

    cache.request('foo');
    await Promise.resolve();
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('subscribe returns an unsubscribe function that stops notifications', async () => {
    const fetcher = vi.fn().mockResolvedValue(fileFixtures);
    const cache = createFileSearchCache(fetcher);
    const listener = vi.fn();
    const unsub = cache.subscribe(listener);
    unsub();

    cache.request('foo');
    await Promise.resolve();
    await Promise.resolve();

    expect(listener).not.toHaveBeenCalled();
  });

  it('logs a warning and does not throw when fetcher rejects', async () => {
    const err = new Error('network error');
    const fetcher = vi.fn().mockRejectedValue(err);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = createFileSearchCache(fetcher);

    cache.request('bad');
    await Promise.resolve();
    await Promise.resolve();

    expect(warnSpy).toHaveBeenCalledWith('[files] search failed', err);
    expect(cache.getItems('bad')).toEqual([]);
    warnSpy.mockRestore();
  });
});

describe('buildFileTriggerAdapter', () => {
  it('categories returns single files category', async () => {
    const fetcher = vi.fn().mockResolvedValue(fileFixtures);
    const cache = createFileSearchCache(fetcher);
    const adapter = buildFileTriggerAdapter(cache);
    expect(adapter.categories()).toEqual([{ id: 'files', label: 'Files' }]);
  });

  it('categoryItems triggers a request and returns cached items', async () => {
    const fetcher = vi.fn().mockResolvedValue(fileFixtures);
    const cache = createFileSearchCache(fetcher);
    const adapter = buildFileTriggerAdapter(cache);

    // Before resolve: empty
    const before = adapter.categoryItems('files');
    expect(before).toEqual([]);

    // Wait for fetcher to resolve
    await Promise.resolve();
    await Promise.resolve();

    // Calling again after resolve should return mapped items
    const after = adapter.categoryItems('files');
    expect(after).toEqual(expectedItems);
  });

  it('search triggers a request and returns cached items for the query', async () => {
    const fetcher = vi.fn().mockResolvedValue(fileFixtures);
    const cache = createFileSearchCache(fetcher);
    const adapter = buildFileTriggerAdapter(cache);

    expect(adapter.search!('index')).toEqual([]);

    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.search!('index')).toEqual(expectedItems);
  });
});
