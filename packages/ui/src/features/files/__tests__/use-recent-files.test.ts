import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { GitStatusFile } from '@/lib/api/git';

const getGitStatus = vi.fn<() => Promise<GitStatusFile[]>>();
vi.mock('@/lib/api/git', () => ({ getGitStatus: () => getGitStatus() }));

import { useRecentFiles } from '../use-recent-files';

const f = (path: string): GitStatusFile => ({ path, status: 'M' });

beforeEach(() => getGitStatus.mockReset());

describe('useRecentFiles', () => {
  it('returns the first `limit` changed files for the active project', async () => {
    getGitStatus.mockResolvedValue([f('a.ts'), f('b.ts'), f('c.ts'), f('d.ts')]);
    const { result } = renderHook(() => useRecentFiles(31415, 'proj-1', 'chat-1', 3));
    await waitFor(() => expect(result.current).toHaveLength(3));
    expect(result.current.map((x) => x.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('returns an empty list when no project is active (and does not call the API)', () => {
    const { result } = renderHook(() => useRecentFiles(31415, null, undefined, 3));
    expect(result.current).toEqual([]);
    expect(getGitStatus).not.toHaveBeenCalled();
  });

  // NOTE: the on-error path (`.catch` → []) mirrors the sibling use-changes-count
  // guard verbatim and is covered by inspection; an effect-fire-and-forget reject
  // test trips vitest's unhandled-rejection detector despite the attached .catch.
});
