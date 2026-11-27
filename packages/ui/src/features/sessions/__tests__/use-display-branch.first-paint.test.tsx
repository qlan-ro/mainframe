import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDisplayBranch } from '../use-display-branch';
import { markFirstTranscriptShown, openAfterFirstPaintForTests, resetAfterFirstPaint } from '@/lib/after-first-paint';

const { getGitBranch } = vi.hoisted(() => ({ getGitBranch: vi.fn(() => Promise.resolve({ branch: 'main' })) }));
vi.mock('@/lib/api/git', () => ({ getGitBranch }));

beforeEach(() => {
  vi.useFakeTimers();
  getGitBranch.mockClear();
  resetAfterFirstPaint();
});
afterEach(() => {
  vi.useRealTimers();
  openAfterFirstPaintForTests();
});

it('reads the branch only after the first paint', async () => {
  const { result } = renderHook(() => useDisplayBranch({ port: 1, projectId: 'p', chatId: 'c', branchName: 'saved' }));
  expect(getGitBranch).not.toHaveBeenCalled();
  expect(result.current.branch).toBe('saved');
  act(() => markFirstTranscriptShown());
  await act(async () => {
    vi.advanceTimersByTime(60);
  });
  expect(getGitBranch).toHaveBeenCalledTimes(1);
  expect(result.current.branch).toBe('main');
});
