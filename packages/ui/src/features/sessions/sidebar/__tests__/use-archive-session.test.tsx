/**
 * useArchiveSession — behavior tests.
 *
 * These lock in the archive-confirm-flow rework's core fix: cancelling the
 * worktree dialog must not touch aui at all (previously the adapter threw
 * AFTER aui's optimistic archive had already switched the active thread away,
 * stranding the user on an empty draft). Asking BEFORE calling
 * itemRuntime.archive() means a cancel never reaches aui — nothing moves.
 *
 * Behaviors covered:
 *  1. hasWorktree=false — archives immediately, no prompt, stages deleteWorktree:false.
 *  2. hasWorktree=true — asks first; itemRuntime.archive() is not called until answered.
 *  3. hasWorktree=true, answer 'cancel' — stageArchiveChoice and itemRuntime.archive()
 *     are never called.
 *  4. hasWorktree=true, answer {deleteWorktree:false} — stages false, then archives.
 *  5. hasWorktree=true, answer {deleteWorktree:true} — stages true, then archives.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const archiveSpy = vi.fn();
const requestWorktreeArchiveChoiceMock = vi.fn();
const stageArchiveChoiceMock = vi.fn();

vi.mock('@assistant-ui/react', () => ({
  useThreadListItemRuntime: () => ({ archive: archiveSpy }),
}));

vi.mock('../../runtime/archive-confirm-bridge', () => ({
  requestWorktreeArchiveChoice: (...args: unknown[]) => requestWorktreeArchiveChoiceMock(...args),
  stageArchiveChoice: (...args: unknown[]) => stageArchiveChoiceMock(...args),
}));

import { useArchiveSession } from '../use-archive-session';

beforeEach(() => {
  archiveSpy.mockReset();
  archiveSpy.mockResolvedValue(undefined);
  requestWorktreeArchiveChoiceMock.mockReset();
  stageArchiveChoiceMock.mockReset();
});

// ---------------------------------------------------------------------------
// 1. No worktree — archive immediately, no prompt
// ---------------------------------------------------------------------------

describe('useArchiveSession — no worktree archives immediately with no prompt', () => {
  it('stages deleteWorktree:false and calls itemRuntime.archive() without asking', async () => {
    const { result } = renderHook(() => useArchiveSession('chat-1', false));

    await act(async () => {
      result.current();
      await Promise.resolve();
    });

    expect(requestWorktreeArchiveChoiceMock).not.toHaveBeenCalled();
    expect(stageArchiveChoiceMock).toHaveBeenCalledTimes(1);
    expect(stageArchiveChoiceMock).toHaveBeenCalledWith('chat-1', { deleteWorktree: false });
    expect(archiveSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Worktree present — asks first, archive() is not called before the
// prompt resolves.
// ---------------------------------------------------------------------------

describe('useArchiveSession — worktree present asks before archiving', () => {
  it('calls requestWorktreeArchiveChoice(chat-1) and does not call itemRuntime.archive() before it resolves', async () => {
    let resolvePrompt: (choice: 'cancel' | { deleteWorktree: boolean }) => void = () => {};
    requestWorktreeArchiveChoiceMock.mockReturnValueOnce(
      new Promise((res) => {
        resolvePrompt = res;
      }),
    );

    const { result } = renderHook(() => useArchiveSession('chat-1', true));

    act(() => {
      result.current();
    });

    expect(requestWorktreeArchiveChoiceMock).toHaveBeenCalledWith('chat-1');
    expect(archiveSpy).not.toHaveBeenCalled();
    expect(stageArchiveChoiceMock).not.toHaveBeenCalled();

    await act(async () => {
      resolvePrompt({ deleteWorktree: false });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(archiveSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Cancel — nothing moves: neither stageArchiveChoice nor archive() run.
// ---------------------------------------------------------------------------

describe('useArchiveSession — cancelling the worktree prompt does nothing', () => {
  it('does not call stageArchiveChoice or itemRuntime.archive() when the answer is "cancel"', async () => {
    requestWorktreeArchiveChoiceMock.mockResolvedValueOnce('cancel');
    const { result } = renderHook(() => useArchiveSession('chat-1', true));

    await act(async () => {
      result.current();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(stageArchiveChoiceMock).not.toHaveBeenCalled();
    expect(archiveSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4/5. Keep vs delete worktree choices stage the right flag before archiving.
// ---------------------------------------------------------------------------

describe('useArchiveSession — "keep worktree" answer stages deleteWorktree:false', () => {
  it('calls stageArchiveChoice(chat-1, { deleteWorktree: false }) then archives', async () => {
    requestWorktreeArchiveChoiceMock.mockResolvedValueOnce({ deleteWorktree: false });
    const { result } = renderHook(() => useArchiveSession('chat-1', true));

    await act(async () => {
      result.current();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(stageArchiveChoiceMock).toHaveBeenCalledTimes(1);
    expect(stageArchiveChoiceMock).toHaveBeenCalledWith('chat-1', { deleteWorktree: false });
    expect(archiveSpy).toHaveBeenCalledTimes(1);
  });
});

describe('useArchiveSession — "delete worktree" answer stages deleteWorktree:true', () => {
  it('calls stageArchiveChoice(chat-1, { deleteWorktree: true }) then archives', async () => {
    requestWorktreeArchiveChoiceMock.mockResolvedValueOnce({ deleteWorktree: true });
    const { result } = renderHook(() => useArchiveSession('chat-1', true));

    await act(async () => {
      result.current();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(stageArchiveChoiceMock).toHaveBeenCalledTimes(1);
    expect(stageArchiveChoiceMock).toHaveBeenCalledWith('chat-1', { deleteWorktree: true });
    expect(archiveSpy).toHaveBeenCalledTimes(1);
  });
});
