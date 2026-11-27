import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useWorkingChanges } from '../use-working-changes';
import { markFirstTranscriptShown, openAfterFirstPaintForTests, resetAfterFirstPaint } from '@/lib/after-first-paint';

const git = vi.hoisted(() => ({
  getGitStatus: vi.fn(() => Promise.resolve([])),
  getWorkingStat: vi.fn(() => Promise.resolve({ files: [], totalAdditions: 0, totalDeletions: 0 })),
  getGitBranch: vi.fn(() => Promise.resolve({ branch: 'main' })),
  getBranchDiffs: vi.fn(),
}));
vi.mock('@/lib/api/git', () => git);
vi.mock('@/lib/api/files', () => ({ getSessionFiles: vi.fn(() => Promise.resolve([])) }));

beforeEach(() => {
  vi.useFakeTimers();
  Object.values(git).forEach((fn) => fn.mockClear());
  resetAfterFirstPaint();
});
afterEach(() => {
  vi.useRealTimers();
  openAfterFirstPaintForTests();
});

it('runs the git status and diff stat reads after the first paint, not while the chat opens', async () => {
  renderHook(() => useWorkingChanges({ port: 1, projectId: 'p', chatId: 'c', withBranch: false }));
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  expect(git.getGitStatus).not.toHaveBeenCalled();
  expect(git.getWorkingStat).not.toHaveBeenCalled();
  act(() => markFirstTranscriptShown());
  await act(async () => {
    vi.advanceTimersByTime(60);
  });
  expect(git.getGitStatus).toHaveBeenCalledTimes(1);
  expect(git.getWorkingStat).toHaveBeenCalledTimes(1);
});
