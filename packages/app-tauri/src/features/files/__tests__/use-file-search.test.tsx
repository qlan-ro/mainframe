import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockSearchFiles = vi.fn();
vi.mock('@/lib/api/files', () => ({
  searchFiles: (...args: unknown[]) => mockSearchFiles(...args),
}));

const { useFileSearch } = await import('../use-file-search');

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
});
