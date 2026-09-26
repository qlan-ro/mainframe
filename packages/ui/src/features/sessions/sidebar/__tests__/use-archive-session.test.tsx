/**
 * useArchiveSession — behavior tests.
 *
 * These lock in the archive-confirm-flow rework's core fix: cancelling the
 * worktree dialog must not touch aui at all (previously the adapter threw
 * AFTER aui's optimistic archive had already switched the active thread away,
 * stranding the user on an empty draft). Asking BEFORE calling
 * aui.threadListItem.archive() means a cancel never reaches aui — nothing moves.
 *
 * Behaviors covered:
 *  1. hasWorktree=false — archives immediately, no prompt, stages deleteWorktree:false.
 *  2. hasWorktree=true — asks first; archive() is not called until answered.
 *  3. hasWorktree=true, answer 'cancel' — stageArchiveChoice and archive()
 *     are never called.
 *  4. hasWorktree=true, answer {deleteWorktree:false} — stages false, then archives.
 *  5. hasWorktree=true, answer {deleteWorktree:true} — stages true, then archives.
 *  6. temporary=true — skips the ask entirely (even with hasWorktree=true),
 *     stages a discard, then routes through itemRuntime.delete(), which drops
 *     the local entry (archive() would leave it lingering).
 *  7. temporary=true, itemRuntime.delete() throws before the adapter ever
 *     consumes the staged flag — it must be cleared anyway.
 *  8. temporary=true, a repeat discard call for the same chat while the first
 *     is still in flight — a no-op.
 *  9. temporary=true, itemRuntime.delete() throws — surfaces an error toast,
 *     not just a console.warn, AND clears the in-flight
 *     entry so a genuine (non-double-click) retry still goes through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const archiveSpy = vi.fn();
const deleteSpy = vi.fn();
const requestWorktreeArchiveChoiceMock = vi.fn();
const stageArchiveChoiceMock = vi.fn();
const stageDiscardMock = vi.fn();
const takeDiscardMock = vi.fn();
const toastErrorSpy = vi.fn();

vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({ threadListItem: { archive: archiveSpy, delete: deleteSpy } }),
}));

vi.mock('@/lib/toast', () => ({
  mfToast: { error: (...args: unknown[]) => toastErrorSpy(...args) },
}));

vi.mock('../../runtime/archive-confirm-bridge', () => ({
  requestWorktreeArchiveChoice: (...args: unknown[]) => requestWorktreeArchiveChoiceMock(...args),
  stageArchiveChoice: (...args: unknown[]) => stageArchiveChoiceMock(...args),
  stageDiscard: (...args: unknown[]) => stageDiscardMock(...args),
  takeDiscard: (...args: unknown[]) => takeDiscardMock(...args),
}));

import { useArchiveSession, clearDiscardStarted } from '../use-archive-session';

beforeEach(() => {
  archiveSpy.mockReset();
  archiveSpy.mockResolvedValue(undefined);
  deleteSpy.mockReset();
  deleteSpy.mockResolvedValue(undefined);
  requestWorktreeArchiveChoiceMock.mockReset();
  stageArchiveChoiceMock.mockReset();
  stageDiscardMock.mockReset();
  takeDiscardMock.mockReset();
  toastErrorSpy.mockReset();
  clearDiscardStarted('chat-1'); // drain the module-level in-flight set every test uses this id under
});

// ---------------------------------------------------------------------------
// 1. No worktree — archive immediately, no prompt
// ---------------------------------------------------------------------------

describe('useArchiveSession — no worktree archives immediately with no prompt', () => {
  it('stages deleteWorktree:false and calls itemRuntime.archive() without asking', async () => {
    const { result } = renderHook(() => useArchiveSession('chat-1', false, false));

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

    const { result } = renderHook(() => useArchiveSession('chat-1', true, false));

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
    const { result } = renderHook(() => useArchiveSession('chat-1', true, false));

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
    const { result } = renderHook(() => useArchiveSession('chat-1', true, false));

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
    const { result } = renderHook(() => useArchiveSession('chat-1', true, false));

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

// ---------------------------------------------------------------------------
// 6. temporary=true — no ask, stages a discard, then discards via
// itemRuntime.delete() (the adapter reads the staged discard flag and calls
// discardChat instead of archiveChat).
// ---------------------------------------------------------------------------

describe('useArchiveSession — a temporary chat skips the ask and stages a discard', () => {
  it('never asks even when hasWorktree is true', async () => {
    const { result } = renderHook(() => useArchiveSession('chat-1', true, true));

    await act(async () => {
      result.current();
      await Promise.resolve();
    });

    expect(requestWorktreeArchiveChoiceMock).not.toHaveBeenCalled();
  });

  it('stages a discard, never a worktree choice, then routes through itemRuntime.delete() — not archive()', async () => {
    const { result } = renderHook(() => useArchiveSession('chat-1', true, true));

    await act(async () => {
      result.current();
      await Promise.resolve();
    });

    expect(stageDiscardMock).toHaveBeenCalledExactlyOnceWith('chat-1');
    expect(stageArchiveChoiceMock).not.toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(archiveSpy).not.toHaveBeenCalled();
  });

  it('clears the staged discard flag afterward, whether or not the adapter consumed it', async () => {
    const { result } = renderHook(() => useArchiveSession('chat-1', true, true));

    await act(async () => {
      result.current();
      await Promise.resolve();
    });

    expect(takeDiscardMock).toHaveBeenCalledExactlyOnceWith('chat-1');
  });

  it('still clears the staged discard flag when itemRuntime.delete() throws before reaching the adapter', async () => {
    deleteSpy.mockRejectedValueOnce(new Error('thread not found while deleting it'));
    const { result } = renderHook(() => useArchiveSession('chat-1', true, true));

    await act(async () => {
      result.current();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(stageDiscardMock).toHaveBeenCalledExactlyOnceWith('chat-1');
    expect(takeDiscardMock).toHaveBeenCalledExactlyOnceWith('chat-1');
  });

  // -------------------------------------------------------------------------
  // 8. A discard already in flight for this chat — the second (double-click)
  // call is a no-op, so it can never race the first call's finally-cleanup.
  // -------------------------------------------------------------------------

  it('is a no-op for a synchronous second call before the first delete() resolves (double-click)', async () => {
    let resolveDelete!: () => void;
    deleteSpy.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveDelete = resolve;
      }),
    );
    const { result } = renderHook(() => useArchiveSession('chat-1', true, true));

    // Two synchronous clicks (a double-click) before the first delete() settles.
    act(() => {
      result.current();
      result.current();
    });

    expect(stageDiscardMock).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDelete();
      await Promise.resolve();
    });

    expect(toastErrorSpy).not.toHaveBeenCalled();
  });

  // For a non-active row, aui's delete() drops the row and the adapter
  // consumes the staged flag synchronously, before the network request
  // settles. The in-flight guard must not depend on that flag.
  it('stays a no-op for a second call even after the adapter has already consumed the staged discard flag', async () => {
    let resolveDelete!: () => void;
    deleteSpy.mockImplementationOnce(() => {
      // Simulate the adapter consuming the staged flag synchronously, as part
      // of routing this call's delete() — before its promise settles.
      takeDiscardMock('chat-1');
      return new Promise<void>((resolve) => {
        resolveDelete = resolve;
      });
    });
    const { result } = renderHook(() => useArchiveSession('chat-1', true, true));

    act(() => {
      result.current(); // first click: delete() in flight, staged flag already consumed
    });
    expect(takeDiscardMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current(); // second click: must stay a no-op despite the flag being gone
    });

    expect(stageDiscardMock).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDelete();
      await Promise.resolve();
    });

    expect(toastErrorSpy).not.toHaveBeenCalled();
  });

  it('allows a genuine retry (not a double-click) after the first discard settles with a failure', async () => {
    deleteSpy.mockRejectedValueOnce(new Error('network error'));
    const { result } = renderHook(() => useArchiveSession('chat-1', true, true));

    await act(async () => {
      result.current();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(toastErrorSpy).toHaveBeenCalledTimes(1);

    deleteSpy.mockResolvedValueOnce(undefined);
    await act(async () => {
      result.current();
      await Promise.resolve();
    });

    expect(deleteSpy).toHaveBeenCalledTimes(2);
    expect(stageDiscardMock).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // 9. A failed discard surfaces an error toast, not just a console.warn
  //.
  // -------------------------------------------------------------------------

  it('surfaces an error toast when itemRuntime.delete() rejects', async () => {
    deleteSpy.mockRejectedValueOnce(new Error('thread not found while deleting it'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useArchiveSession('chat-1', true, true));

    await act(async () => {
      result.current();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toastErrorSpy).toHaveBeenCalledExactlyOnceWith('Could not discard the chat', {
      description: 'thread not found while deleting it',
    });
    warn.mockRestore();
  });
});
