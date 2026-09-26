// @vitest-environment jsdom
/**
 * useGhostChatPrune — behavior tests (todo #346).
 *
 * Verifies the hook's own contract in isolation from useSessionListRouter:
 * reconciles the persistent discarded set against `items` on every change,
 * stages a local-only removal before calling threads.item(id).delete(),
 * skips ids not (yet) present in `items` WITHOUT dropping them, and clears
 * the staged flag if delete() rejects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { SessionItem } from '../../view-model/chat-to-thread-custom';
import { markChatDiscarded, getDiscardedChatIds, clearDiscardedChatId } from '../../runtime/ghost-chat-queue';
import { takeLocalOnlyRemoval } from '../../runtime/archive-confirm-bridge';
import { useGhostChatPrune, type GhostChatPruneThreads } from '../use-ghost-chat-prune';

function item(id: string): SessionItem {
  return { id } as SessionItem;
}

function makeThreads(deleteImpl: (id: string) => unknown): {
  threads: GhostChatPruneThreads;
  deleteSpy: ReturnType<typeof vi.fn>;
} {
  const deleteSpy = vi.fn(deleteImpl);
  return {
    threads: { item: ({ id }) => ({ delete: () => deleteSpy(id) }) },
    deleteSpy,
  };
}

beforeEach(() => {
  for (const id of getDiscardedChatIds()) clearDiscardedChatId(id); // drain any leftovers from another test file
});

describe('useGhostChatPrune', () => {
  it('does nothing on mount when the set is empty', () => {
    const { threads, deleteSpy } = makeThreads(() => Promise.resolve());
    renderHook(() => useGhostChatPrune([item('chat-1')], threads));

    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('deletes a ghost id present in items on mount', async () => {
    markChatDiscarded('chat-1');
    const { threads, deleteSpy } = makeThreads(() => Promise.resolve());
    renderHook(() => useGhostChatPrune([item('chat-1'), item('chat-2')], threads));
    await Promise.resolve();

    expect(deleteSpy).toHaveBeenCalledExactlyOnceWith('chat-1');
  });

  it('does NOT drop an id not yet present in items — it retries once items catches up', async () => {
    markChatDiscarded('chat-1');
    const { threads, deleteSpy } = makeThreads(() => Promise.resolve());
    const { rerender } = renderHook(({ items }) => useGhostChatPrune(items, threads), {
      initialProps: { items: [item('chat-2')] },
    });
    await Promise.resolve();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect([...getDiscardedChatIds()]).toEqual(['chat-1']); // still pending, not dropped

    // A later reload lands chat-1 in the list.
    rerender({ items: [item('chat-1'), item('chat-2')] });
    await Promise.resolve();

    expect(deleteSpy).toHaveBeenCalledExactlyOnceWith('chat-1');
  });

  it('clears the id from the set only after delete() succeeds', async () => {
    markChatDiscarded('chat-1');
    const { threads } = makeThreads(() => Promise.resolve());
    renderHook(() => useGhostChatPrune([item('chat-1')], threads));

    expect([...getDiscardedChatIds()]).toEqual(['chat-1']); // still present synchronously
    await Promise.resolve();
    await Promise.resolve();

    expect(getDiscardedChatIds().size).toBe(0);
  });

  it('stages a local-only removal for the id before calling delete()', async () => {
    let stagedDuringDelete = false;
    markChatDiscarded('chat-1');
    const { threads } = makeThreads((id) => {
      stagedDuringDelete = takeLocalOnlyRemoval(id); // true means it WAS staged before delete() ran
      return Promise.resolve();
    });
    renderHook(() => useGhostChatPrune([item('chat-1')], threads));
    await Promise.resolve();

    expect(stagedDuringDelete).toBe(true);
  });

  it('clears the staged local-only flag when delete() rejects, and keeps the id pending for retry', async () => {
    markChatDiscarded('chat-1');
    const { threads } = makeThreads(() => Promise.reject(new Error('thread not found while deleting it')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderHook(() => useGhostChatPrune([item('chat-1')], threads));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(takeLocalOnlyRemoval('chat-1')).toBe(false); // already cleared by the hook's catch
    expect([...getDiscardedChatIds()]).toEqual(['chat-1']); // stays pending, not silently dropped
    warn.mockRestore();
  });

  it('reconciles multiple pending ids present in items in one pass', async () => {
    markChatDiscarded('chat-1');
    markChatDiscarded('chat-2');
    const { threads, deleteSpy } = makeThreads(() => Promise.resolve());
    renderHook(() => useGhostChatPrune([item('chat-1'), item('chat-2')], threads));
    await Promise.resolve();

    expect(deleteSpy).toHaveBeenCalledTimes(2);
    expect(deleteSpy).toHaveBeenCalledWith('chat-1');
    expect(deleteSpy).toHaveBeenCalledWith('chat-2');
  });

  it('does not fire a second concurrent delete() for the same id across back-to-back items changes', async () => {
    markChatDiscarded('chat-1');
    let resolveDelete!: () => void;
    const { threads, deleteSpy } = makeThreads(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const { rerender } = renderHook(({ items }) => useGhostChatPrune(items, threads), {
      initialProps: { items: [item('chat-1')] },
    });
    await Promise.resolve();
    expect(deleteSpy).toHaveBeenCalledTimes(1);

    // Another items change lands while the first delete() is still pending.
    rerender({ items: [item('chat-1'), item('chat-3')] });
    await Promise.resolve();
    expect(deleteSpy).toHaveBeenCalledTimes(1); // not called again while in flight

    resolveDelete();
    await Promise.resolve();
    await Promise.resolve();
    expect(getDiscardedChatIds().size).toBe(0);
  });
});
