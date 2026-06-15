import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockSearchFiles = vi.fn();
vi.mock('@/lib/api/files', () => ({
  searchFiles: (...args: unknown[]) => mockSearchFiles(...args),
}));

const { useFileSearch, dirOf } = await import('../use-file-search');

// ---------------------------------------------------------------------------
// Finding F: dirOf unit tests
// ---------------------------------------------------------------------------

describe('dirOf', () => {
  it('returns the directory portion for a nested path', () => {
    expect(dirOf('src/a.ts')).toBe('src');
  });

  it('returns "." for a root-level file with no slash', () => {
    expect(dirOf('a.ts')).toBe('.');
  });

  it('returns the full directory for a deeply nested path', () => {
    expect(dirOf('src/features/files/use-file-search.tsx')).toBe('src/features/files');
  });
});

describe('useFileSearch', () => {
  beforeEach(() => {
    mockSearchFiles.mockClear();
  });

  it('returns empty results before a query is set', () => {
    const { result } = renderHook(() => useFileSearch(31415, 'proj-1', undefined));
    expect(result.current.results).toEqual([]);
    expect(result.current.searched).toBe(false);
  });

  it('queries searchFiles and exposes results after debounce', async () => {
    mockSearchFiles.mockResolvedValue([{ name: 'a.ts', path: 'src/a.ts', type: 'file', exact: false }]);
    const { result, rerender } = renderHook(({ q }: { q: string }) => useFileSearch(31415, 'proj-1', undefined, q), {
      initialProps: { q: '' },
    });
    act(() => rerender({ q: 'aa' }));
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(mockSearchFiles).toHaveBeenCalledWith(31415, 'proj-1', 'aa', undefined);
    expect(result.current.searched).toBe(true);
  });

  it('does not query for queries shorter than 2 chars', async () => {
    const { rerender } = renderHook(({ q }: { q: string }) => useFileSearch(31415, 'proj-1', undefined, q), {
      initialProps: { q: '' },
    });
    act(() => rerender({ q: 'a' }));
    await new Promise((r) => setTimeout(r, 350));
    expect(mockSearchFiles).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Finding A: stale-results race — dropping below minLength must invalidate
  // any in-flight request so a late response cannot overwrite cleared state.
  // ---------------------------------------------------------------------------

  it('ignores a stale searchFiles response when query drops below minLength', async () => {
    // A deferred promise we control: start it, then drop the query,
    // wait for debounce to propagate the below-min value, then resolve.
    let resolveLate!: (v: { name: string; path: string; type: string; exact: boolean }[]) => void;
    const lateResult = [{ name: 'a.ts', path: 'src/a.ts', type: 'file', exact: false }];
    const deferred = new Promise<{ name: string; path: string; type: string; exact: boolean }[]>((r) => {
      resolveLate = r;
    });
    mockSearchFiles.mockReturnValueOnce(deferred);

    const { result, rerender } = renderHook(({ q }: { q: string }) => useFileSearch(31415, 'proj-1', undefined, q), {
      initialProps: { q: 'aa' },
    });

    // Wait for debounce (300ms) + the in-flight request to start
    await waitFor(() => expect(mockSearchFiles).toHaveBeenCalledTimes(1));

    // Drop query below minLength
    act(() => rerender({ q: 'a' }));

    // Wait for the debounce to propagate the below-min value ('a') so the
    // effect re-runs and bumps reqIdRef before we resolve the stale promise.
    await new Promise((r) => setTimeout(r, 350));

    // Resolve the first (now stale) promise — reqId is invalidated, must not land
    act(() => resolveLate(lateResult));

    // Give React time to process the microtask
    await new Promise((r) => setTimeout(r, 50));

    // The stale response must NOT have landed
    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
