/**
 * useNewChatHotkeyHandler — behavior tests.
 *
 * One behavior for every view now that the anchored "NEW SESSION IN…" popover
 * is gone: reset the stale draft on the reused slot, then switch to the new
 * thread. No project-filter branch — the welcome screen's own picker (or
 * useNewThreadAutoConfig, with a pill active) resolves the project afterwards.
 */
import { it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const resetNewThreadDraftSpy = vi.fn();
vi.mock('../reset-new-thread-draft', () => ({
  resetNewThreadDraft: (...args: unknown[]) => resetNewThreadDraftSpy(...args),
}));

import { useNewChatHotkeyHandler } from '../use-new-chat-hotkey-handler';

function makeRuntime(newThreadId: string | null, switchToNewThread = vi.fn()) {
  return {
    threads: {
      getState: () => ({ newThreadId }),
      switchToNewThread,
    },
  } as unknown as Parameters<typeof useNewChatHotkeyHandler>[0];
}

beforeEach(() => {
  resetNewThreadDraftSpy.mockReset();
});

it('resets the draft on the reused slot and switches to the new thread', () => {
  const switchToNewThread = vi.fn();
  const runtime = makeRuntime('__LOCALID_1', switchToNewThread);

  const { result } = renderHook(() => useNewChatHotkeyHandler(runtime));
  result.current();

  expect(resetNewThreadDraftSpy).toHaveBeenCalledExactlyOnceWith('__LOCALID_1');
  expect(switchToNewThread).toHaveBeenCalledTimes(1);
});

it('still switches to the new thread when no draft slot is allocated yet', () => {
  const switchToNewThread = vi.fn();
  const runtime = makeRuntime(null, switchToNewThread);

  const { result } = renderHook(() => useNewChatHotkeyHandler(runtime));
  result.current();

  expect(resetNewThreadDraftSpy).toHaveBeenCalledExactlyOnceWith(null);
  expect(switchToNewThread).toHaveBeenCalledTimes(1);
});

it('resets the draft before switching, so the fresh thread never reads the stale config', () => {
  const order: string[] = [];
  resetNewThreadDraftSpy.mockImplementation(() => void order.push('reset'));
  const runtime = makeRuntime(
    '__LOCALID_1',
    vi.fn(() => void order.push('switch')),
  );

  const { result } = renderHook(() => useNewChatHotkeyHandler(runtime));
  result.current();

  expect(order).toEqual(['reset', 'switch']);
});
