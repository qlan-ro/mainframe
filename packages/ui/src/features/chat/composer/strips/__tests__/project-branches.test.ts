// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const getGitBranch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/git', () => ({ getGitBranch }));

import { setProjectBranch, useProjectBranch, useProjectBranches } from '../project-branches';

function deferred() {
  let resolve: (branch: string | null) => void = () => {};
  const promise = new Promise<{ branch: string | null }>((r) => {
    resolve = (branch) => r({ branch });
  });
  return { promise, resolve };
}
const flush = () => act(async () => {});

beforeEach(() => {
  getGitBranch.mockReset();
  useProjectBranches.setState({ byProject: {} });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('useProjectBranch', () => {
  it('is unknown until it is read, then what git says', async () => {
    getGitBranch.mockResolvedValue({ branch: 'main' });
    const { result } = renderHook(() => useProjectBranch(1, 'p1'));
    expect(result.current.branch).toBeUndefined();
    await waitFor(() => expect(result.current.branch).toBe('main'));
    expect(getGitBranch).toHaveBeenCalledExactlyOnceWith(1, 'p1');
  });

  it('shows a checkout made elsewhere on screen', async () => {
    getGitBranch.mockResolvedValue({ branch: 'main' });
    const picker = renderHook(() => useProjectBranch(1, 'p1'));
    const emptyState = renderHook(() => useProjectBranch(1, 'p1'));
    await waitFor(() => expect(emptyState.result.current.branch).toBe('main'));
    getGitBranch.mockResolvedValue({ branch: 'feat/x' });
    act(() => picker.result.current.reload());
    await waitFor(() => expect(emptyState.result.current.branch).toBe('feat/x'));
  });

  it('drops an older answer that comes last', async () => {
    const old = deferred();
    const fresh = deferred();
    getGitBranch.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const { result } = renderHook(() => useProjectBranch(1, 'p1'));
    act(() => result.current.reload());
    fresh.resolve('feat/x');
    await flush();
    old.resolve('main');
    await flush();
    expect(result.current.branch).toBe('feat/x');
  });

  it('drops a read that was out when something newer said', async () => {
    const read = deferred();
    getGitBranch.mockReturnValue(read.promise);
    const { result } = renderHook(() => useProjectBranch(1, 'p1'));
    act(() => setProjectBranch('p1', 'feat/x'));
    read.resolve('main');
    await flush();
    expect(result.current.branch).toBe('feat/x');
  });

  it('keeps each project its own, whichever answers first', async () => {
    const a = deferred();
    const b = deferred();
    getGitBranch.mockImplementation((_port: number, id: string) => (id === 'a' ? a.promise : b.promise));
    const { result, rerender } = renderHook(({ id }) => useProjectBranch(1, id), { initialProps: { id: 'a' } });
    rerender({ id: 'b' });
    b.resolve('b-branch');
    await flush();
    a.resolve('a-branch');
    await flush();
    expect(result.current.branch).toBe('b-branch');
  });

  it('claims no branch after a failed read', async () => {
    setProjectBranch('p1', 'main');
    getGitBranch.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useProjectBranch(1, 'p1'));
    await waitFor(() => expect(result.current.branch).toBeNull());
  });

  it('reads nothing without a project', () => {
    renderHook(() => useProjectBranch(1, null));
    expect(getGitBranch).not.toHaveBeenCalled();
  });
});
